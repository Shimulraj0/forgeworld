import * as THREE from 'three';
import type { AssetInfo, Category, Comp, Cost, ItemId } from './catalog';
import { CATEGORIES, CATEGORY_COLOR, ITEM, RAW, fmtBytes, fmtNum, getAsset } from './catalog';
import {
  REFINE,
  REFINE_ORDER,
  affordableCount,
  costList,
  describeCost,
  expandToRaw,
  trySpend,
} from './economy';
import type { Game } from './game';
import { GOALS } from './goals';
import { BUILD } from './credit';
import { sfx } from './sfx';

type Tab = 'refine' | 'build' | 'library';
type ToastKind = 'good' | 'warn' | 'info';

const HF_BLOB = 'https://huggingface.co/datasets/codepawl/simready-glb/blob/main';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function need<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`FORGE WORLD: missing #${id}`);
  return el as T;
}

export class UI {
  private readonly game: Game;
  private tab: Tab = 'refine';
  private search = '';
  private catFilter: Category | 'All' = 'All';
  private localOnly = false;
  private limit = 36;
  private focusSearch = false;
  private searchCaret = 0;
  private clockAcc = 0;
  private goalsCollapsed = false;
  private prevRes: Partial<Record<ItemId, number>> = {};

  private resAmts = {} as Record<ItemId, HTMLElement>;
  private panelBody!: HTMLElement;
  private panelSub!: HTMLElement;
  private badgeBuild!: HTMLElement;
  private badgeLib!: HTMLElement;
  private tabs: Partial<Record<Tab, HTMLElement>> = {};
  private clockEl!: HTMLElement;

  private readonly el = {
    resources: need<HTMLElement>('resources'),
    goals: need<HTMLElement>('goals'),
    prompt: need<HTMLElement>('prompt'),
    hotbar: need<HTMLElement>('hotbar'),
    hintbar: need<HTMLElement>('hintbar'),
    panel: need<HTMLElement>('panel'),
    toasts: need<HTMLElement>('toasts'),
    floaters: need<HTMLElement>('floaters'),
    modal: need<HTMLElement>('modal'),
    intro: need<HTMLElement>('intro'),
    loading: need<HTMLElement>('loading'),
    loadingFill: need<HTMLElement>('loading-fill'),
    btnCraft: need<HTMLButtonElement>('btn-craft'),
    btnHelp: need<HTMLButtonElement>('btn-help'),
    btnStart: need<HTMLButtonElement>('btn-start'),
  };

  constructor(game: Game) {
    this.game = game;
  }

  init() {
    this.buildResources();
    this.buildHintbar();
    this.buildPanel();
    this.renderGoals();
    this.renderHotbar();
    this.setClock();

    this.el.btnCraft.addEventListener('click', () => {
      sfx.unlock();
      sfx.click();
      this.togglePanel('refine');
    });
    this.el.btnHelp.addEventListener('click', () => {
      sfx.unlock();
      sfx.click();
      this.showHelp();
    });
    this.el.btnStart.addEventListener('click', () => {
      sfx.unlock();
      sfx.click();
      this.el.intro.classList.add('hidden');
      window.setTimeout(() => this.toast('Objective · chop a silverleaf tree with E', 'good'), 700);
    });

    this.el.goals.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('.goals-head')) return;
      this.goalsCollapsed = !this.goalsCollapsed;
      this.el.goals.classList.toggle('collapsed', this.goalsCollapsed);
      sfx.click();
    });

    this.el.hotbar.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-hot]');
      if (!btn?.dataset.hot) return;
      sfx.unlock();
      sfx.click();
      void this.activateItem(btn.dataset.hot);
    });

    this.el.panel.addEventListener('click', (e) => this.onPanelClick(e));
    this.el.panel.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.id !== 'asset-search') return;
      this.search = input.value;
      this.searchCaret = input.selectionStart ?? input.value.length;
      this.limit = 36;
      this.focusSearch = true;
      this.renderPanel();
    });

    this.el.modal.addEventListener('click', (e) => this.onModalClick(e));
  }

  // ------------------------------------------------------------ chrome

  private buildResources() {
    this.el.resources.innerHTML = RAW.map(
      (m) =>
        `<div class="res" title="${esc(ITEM[m].label)}" style="--tint:${ITEM[m].color}22">
          <span class="ico">${ITEM[m].icon}</span>
          <span class="amt" data-res="${m}">0</span>
          <span class="lbl">${esc(ITEM[m].short)}</span>
        </div>`,
    ).join('');
    for (const m of RAW) {
      const amt = this.el.resources.querySelector<HTMLElement>(`[data-res="${m}"]`);
      if (amt) this.resAmts[m] = amt;
    }
  }

  private buildHintbar() {
    this.el.hintbar.innerHTML = `
      <span><b>WASD</b> move</span>
      <span><b>Shift</b> sprint</span>
      <span><b>Space</b> jump</span>
      <span><b>E</b> gather</span>
      <span><b>C</b> fabricator</span>
      <span><b>B</b> build</span>
      <span><b>H</b> help</span>
      <span class="clock" id="clock"></span>`;
    const clock = this.el.hintbar.querySelector<HTMLElement>('#clock');
    if (clock) this.clockEl = clock;
  }

  private buildPanel() {
    this.el.panel.innerHTML = `
      <div class="panel-head">
        <div>
          <h2>Fabricator</h2>
          <div class="sub" id="panel-sub"></div>
        </div>
        <button class="close" data-act="close" title="Close (Esc)" aria-label="Close">✕</button>
      </div>
      <div class="tabs">
        <button class="tab" data-tab="refine">Refine</button>
        <button class="tab" data-tab="build">Build<span class="badge" id="badge-build"></span></button>
        <button class="tab" data-tab="library">Library<span class="badge" id="badge-lib"></span></button>
      </div>
      <div class="panel-body" id="panel-body"></div>`;
    this.panelBody = need<HTMLElement>('panel-body');
    this.panelSub = need<HTMLElement>('panel-sub');
    this.badgeBuild = need<HTMLElement>('badge-build');
    this.badgeLib = need<HTMLElement>('badge-lib');
    for (const t of ['refine', 'build', 'library'] as Tab[]) {
      const btn = this.el.panel.querySelector<HTMLElement>(`[data-tab="${t}"]`);
      if (btn) this.tabs[t] = btn;
    }
  }

  setLoading(p: number, text: string) {
    this.el.loadingFill.style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
    const label = this.el.loading.querySelector<HTMLElement>('.loading-text');
    if (label) label.textContent = text;
  }

  hideLoading() {
    window.setTimeout(() => {
      this.el.loading.classList.add('hidden');
    }, 260);
  }

  showIntro() {
    this.el.intro.classList.remove('hidden');
  }

  hideIntro() {
    this.el.intro.classList.add('hidden');
  }

  setPrompt(html: string | null) {
    if (!html) {
      this.el.prompt.classList.remove('show');
      this.el.prompt.innerHTML = '';
      return;
    }
    if (this.el.prompt.innerHTML !== html) this.el.prompt.innerHTML = html;
    this.el.prompt.classList.add('show');
  }

  // ------------------------------------------------------------ panels

  openPanel(tab: Tab) {
    this.tab = tab;
    this.el.panel.classList.add('open');
    this.el.panel.setAttribute('aria-hidden', 'false');
    this.renderPanel();
  }

  closePanel() {
    this.el.panel.classList.remove('open');
    this.el.panel.setAttribute('aria-hidden', 'true');
  }

  togglePanel(tab: Tab) {
    if (this.panelOpen() && this.tab === tab) this.closePanel();
    else this.openPanel(tab);
  }

  panelOpen(): boolean {
    return this.el.panel.classList.contains('open');
  }

  anyModalOpen(): boolean {
    return this.el.modal.classList.contains('open');
  }

  closeModal() {
    this.el.modal.classList.remove('open');
    this.el.modal.setAttribute('aria-hidden', 'true');
  }

  // ------------------------------------------------------------ refresh

  refresh() {
    this.refreshResources();
    this.renderGoals();
    this.renderHotbar();
    this.renderChrome();
    if (this.panelOpen()) this.renderPanel();
  }

  private refreshResources() {
    for (const m of RAW) {
      const amt = this.resAmts[m];
      if (!amt) continue;
      const v = this.game.mats[m] ?? 0;
      const prev = this.prevRes[m];
      if (amt.textContent !== String(v)) amt.textContent = String(v);
      const chip = amt.parentElement;
      chip?.classList.toggle('low', v === 0);
      if (prev !== undefined && v > prev && chip) {
        chip.classList.add('bump');
        window.setTimeout(() => chip.classList.remove('bump'), 550);
      }
      this.prevRes[m] = v;
    }
  }

  private renderGoals() {
    const done = this.game.goalsDone;
    const rows = GOALS.map((g) => {
      const [n, total] = g.progress(this.game);
      const hit = done.has(g.id) || n >= total;
      const pct = Math.min(total, Math.max(0, n));
      return `<div class="goal${hit ? ' done' : ''}">
        <span class="box">✓</span>
        <span class="txt">${esc(g.label)}<span class="prog">${pct} / ${total}</span></span>
      </div>`;
    }).join('');
    const count = GOALS.filter((g) => done.has(g.id)).length;
    this.el.goals.innerHTML = `
      <div class="goals-head" title="${this.goalsCollapsed ? 'Expand' : 'Collapse'} objectives">
        <h2>Objectives</h2>
        <span class="count">${count} / ${GOALS.length}</span>
      </div>
      <div class="goal-list">${rows}</div>
      <div class="goals-foot"><span class="dot"></span>${GOALS.length - count} remaining · rewards auto-claim</div>`;
    this.el.goals.classList.toggle('collapsed', this.goalsCollapsed);
  }

  private hotbarIds(): string[] {
    const owned = Object.entries(this.game.props)
      .filter(([, n]) => n > 0)
      .map(([id]) => id);
    const rank = (id: string) => {
      const i = this.game.unlockedOrder.indexOf(id);
      return i < 0 ? 999 : i;
    };
    owned.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    if (owned.length < 8) {
      for (const id of this.game.unlockedOrder) {
        if (owned.length >= 8) break;
        if (!owned.includes(id)) owned.push(id);
      }
    }
    return owned.slice(0, 8);
  }

  private renderHotbar() {
    const ids = this.hotbarIds();
    this.el.hotbar.classList.toggle('empty', ids.length === 0);
    this.el.hotbar.innerHTML = ids
      .map((id, i) => {
        const info = getAsset(id);
        const n = this.game.props[id] ?? 0;
        const active = this.game.placer.activeId === id;
        const disabled = n <= 0;
        return `<button class="slot${n <= 0 ? ' missing' : ''}${active ? ' active' : ''}" data-hot="${esc(id)}"
          title="${esc(info?.name ?? id)} · ${n} owned · press ${i + 1}"
          ${disabled ? 'disabled' : ''}
          ${!disabled ? `style="opacity: 1;"` : `style="opacity: 0.5;"`}
        >
          <span class="key">${i + 1}</span>
          ${info ? `<img src="${esc(info.thumb)}" alt="${esc(info.name)}" loading="lazy" draggable="false" />` : '<span class="em">📦</span>'}
          <span class="n">${n}</span>
        </button>`;
      })
      .join('');
    this.bindImages(this.el.hotbar);
  }

  private bindImages(root: ParentNode) {
    root.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
      img.addEventListener(
        'error',
        () => {
          const span = document.createElement('span');
          span.className = 'fallback';
          span.textContent = '📦';
          img.replaceWith(span);
        },
        { once: true },
      );
    });
  }

  // ------------------------------------------------------------ refresh chrome

  private renderChrome() {
    const ownedUnits = Object.values(this.game.props).reduce((a, b) => a + b, 0);
    const total = this.game.catalog.length;
    this.badgeBuild.textContent = ownedUnits > 0 ? String(ownedUnits) : '';
    this.badgeLib.textContent = total ? fmtNum(total) : '';
    for (const t of ['refine', 'build', 'library'] as Tab[]) {
      this.tabs[t]?.classList.toggle('active', t === this.tab);
    }
    const placing = this.game.placer.activeId
      ? getAsset(this.game.placer.activeId)?.name ?? 'prop'
      : '';
    switch (this.tab) {
      case 'refine':
        this.panelSub.textContent = `${this.game.stats.refined} refined · auto-crafts intermediates`;
        break;
      case 'build':
        this.panelSub.textContent = placing
          ? `Placing ${placing} — click the island`
          : `${ownedUnits} prop${ownedUnits === 1 ? '' : 's'} ready · click one to place`;
        break;
      default:
        this.panelSub.textContent = `${fmtNum(total)} assets · ${fmtNum(this.game.catalog.filter((a) => a.local).length)} bundled for instant play`;
    }
    const active = this.game.placer.active || this.panelOpen();
    this.el.btnCraft.classList.toggle('active', active);
  }

  private renderPanel() {
    this.renderChrome();
    switch (this.tab) {
      case 'refine':
        this.panelBody.innerHTML = this.refineHtml();
        break;
      case 'build':
        this.panelBody.innerHTML = this.buildHtml();
        break;
      default:
        this.panelBody.innerHTML = this.libraryHtml();
        break;
    }
    this.bindImages(this.panelBody);
    if (this.focusSearch) {
      this.focusSearch = false;
      const input = this.panelBody.querySelector<HTMLInputElement>('#asset-search');
      if (input) {
        input.focus();
        const caret = Math.min(this.searchCaret, input.value.length);
        input.setSelectionRange(caret, caret);
      }
    }
  }

  private onPanelClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    const tab = t.closest<HTMLElement>('[data-tab]')?.dataset.tab;
    if (tab === 'refine' || tab === 'build' || tab === 'library') {
      this.tab = tab;
      sfx.click();
      this.renderPanel();
      return;
    }
    if (t.closest('[data-act="close"]')) {
      this.closePanel();
      sfx.click();
      return;
    }
    const cat = t.closest<HTMLElement>('[data-cat]')?.dataset.cat;
    if (cat) {
      this.catFilter = cat === 'All' ? 'All' : (cat as Category);
      this.limit = 36;
      this.renderPanel();
      return;
    }
    if (t.closest('[data-local]')) {
      this.localOnly = !this.localOnly;
      this.limit = 36;
      this.renderPanel();
      return;
    }
    const refine = t.closest<HTMLElement>('[data-refine]')?.dataset.refine;
    if (refine) {
      this.game.craftComponent(refine as Comp);
      return;
    }
    const asset = t.closest<HTMLElement>('[data-asset]')?.dataset.asset;
    if (asset) {
      this.showDetail(asset);
      return;
    }
    const place = t.closest<HTMLElement>('[data-place]')?.dataset.place;
    if (place) {
      this.closePanel();
      void this.game.selectPlace(place);
      return;
    }
    if (t.closest('[data-act="buildtoggle"]')) {
      this.game.toggleBuild();
      return;
    }
    if (t.closest('[data-act="cancelplace"]')) {
      this.game.stopPlacing();
      return;
    }
    if (t.closest('[data-act="more"]')) {
      this.limit += 36;
      this.renderPanel();
    }
  }

  // ------------------------------------------------------------ refine tab

  private chip(k: ItemId, v: number, missing = false): string {
    const it = ITEM[k];
    return `<span class="cost-chip${missing ? ' need' : ''}"><span class="em">${it.icon}</span>${v} ${esc(it.short)}</span>`;
  }

  private refineHtml(): string {
    const inv = this.game.mats;
    const raw = RAW.map((m) => this.chip(m, inv[m] ?? 0)).join('');
    const recipes = REFINE_ORDER.map((comp) => {
      const recipe = REFINE[comp];
      const it = ITEM[comp];
      const afford = affordableCount(inv, comp);
      const missing = costList(recipe).some(([k, v]) => (inv[k] ?? 0) < v);
      const chips = costList(recipe)
        .map(([k, v]) => this.chip(k, v, (inv[k] ?? 0) < v))
        .join('');
      return `<button type="button" class="recipe${afford > 0 ? '' : ' off'}" data-refine="${comp}"
        title="${esc(it.label)} — ${esc(describeCost(recipe))}">
        <div class="r-head">
          <span class="r-ico" style="--tint:${it.color}22">${it.icon}</span>
          <span class="r-name">${esc(it.label)}</span>
          <span class="r-out">×${inv[comp] ?? 0}</span>
        </div>
        <div class="r-cost${missing ? ' need' : ''}">${chips}</div>
        <div class="r-foot">${afford > 0 ? `Can refine ×${afford}` : 'Need more raw stock'}</div>
      </button>`;
    }).join('');

    return `
      <div class="section-label">Raw stock</div>
      <div class="rawline">${raw}</div>
      <p class="tip">Harvest nodes with <kbd>E</kbd>. Every node regrows after a short cooldown, so the island never runs dry.</p>

      <div class="section-label">Refinement chain</div>
      <div class="grid-2">${recipes}</div>

      <div class="section-label">How it works</div>
      <p class="tip">
        <b>2 Wood → 1 Plank</b> · <b>2 Metal → 1 Plate</b> · <b>2 Plank + 1 Plate → 1 Frame</b>.<br />
        Fabricating an asset automatically consumes any missing intermediates straight from raw stock —
        so you can go from tree to industrial robot in one click.
      </p>`;
  }

  // ------------------------------------------------------------ build tab

  private buildHtml(): string {
    const activeId = this.game.placer.activeId;
    const bar = activeId
      ? `<div class="placebar">
          <span>Placing <b>${esc(getAsset(activeId)?.name ?? activeId)}</b> — click the island.
          <kbd>R</kbd> rotate · <kbd>Esc</kbd> cancel</span>
          <button class="ghost-btn small" data-act="cancelplace">Cancel</button>
        </div>`
      : `<div class="placebar">
          <span>Pick a prop to enter build mode. The grid appears while placing.</span>
          <button class="ghost-btn small" data-act="buildtoggle">${this.game.buildMode ? 'Exit build' : 'Show grid'}</button>
        </div>`;

    const entries = Object.entries(this.game.props)
      .filter(([, n]) => n > 0)
      .sort((a, b) => {
        const ia = this.game.unlockedOrder.indexOf(a[0]);
        const ib = this.game.unlockedOrder.indexOf(b[0]);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a[0].localeCompare(b[0]);
      });

    if (entries.length === 0) {
      return `${bar}
        <div class="empty-state">
          Nothing built yet.<br />
          <span class="dimline">Harvest raw stock, refine components, then fabricate in the Library.</span>
        </div>
        <button class="more-btn" data-tab="library">Browse ${fmtNum(this.game.catalog.length)} assets →</button>`;
    }

    const cards = entries
      .map(([id, n]) => this.assetCard(getAsset(id), n, 'place'))
      .join('');

    return `${bar}
      <div class="section-label">Your props</div>
      <div class="asset-grid">${cards}</div>
      <p class="tip">Right-click a placed prop — or press <kbd>X</kbd> in build mode — to recover it back into your inventory.</p>`;
  }

  // ------------------------------------------------------------ library tab

  private matches(a: AssetInfo): boolean {
    if (this.localOnly && !a.local) return false;
    if (this.catFilter !== 'All' && a.cat !== this.catFilter) return false;
    const q = this.search.trim().toLowerCase();
    if (!q) return true;
    return a.id.includes(q) || a.name.toLowerCase().includes(q) || a.cat.toLowerCase().includes(q);
  }

  private libraryHtml(): string {
    const all = this.game.catalog;
    const list = all.filter((a) => this.matches(a)).sort((a, b) => {
      const oa = (this.game.props[a.id] ?? 0) > 0 ? 0 : 1;
      const ob = (this.game.props[b.id] ?? 0) > 0 ? 0 : 1;
      if (oa !== ob) return oa - ob;
      if (a.local !== b.local) return a.local ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    const shown = list.slice(0, this.limit);
    const cards = shown.map((a) => this.assetCard(a, this.game.props[a.id] ?? 0, 'detail')).join('');

    const cats = (['All', ...CATEGORIES] as (Category | 'All')[])
      .map(
        (c) =>
          `<button class="chip${this.catFilter === c ? ' on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`,
      )
      .join('');

    return `
      <div class="search-row">
        <label class="search">
          <span class="ico">⌕</span>
          <input id="asset-search" type="text" spellcheck="false" autocomplete="off"
            placeholder="Search ${fmtNum(all.length)} SimReady assets…" value="${esc(this.search)}" />
        </label>
      </div>
      <div class="chips">${cats}</div>
      <div class="chips">
        <button class="chip${this.localOnly ? ' on' : ''}" data-local="1" title="Only the 58 bundled starter assets">
          ● Starter pack
        </button>
        <span class="lib-count">${fmtNum(list.length)} match${list.length === 1 ? '' : 'es'} · showing ${shown.length}</span>
      </div>
      ${cards ? `<div class="asset-grid">${cards}</div>` : '<div class="empty-state">No assets match that search.</div>'}
      ${list.length > shown.length ? `<button class="more-btn" data-act="more">Load ${Math.min(36, list.length - shown.length)} more · ${fmtNum(list.length - shown.length)} remaining</button>` : ''}`;
  }

  private assetCard(info: AssetInfo | undefined, owned: number, action: 'place' | 'detail'): string {
    if (!info) return '';
    const attr = action === 'place' ? `data-place="${esc(info.id)}"` : `data-asset="${esc(info.id)}"`;
    const color = CATEGORY_COLOR[info.cat];
    return `<button type="button" class="asset" ${attr} title="${esc(info.name)}">
      <div class="thumb">
        <img src="${esc(info.thumb)}" alt="" loading="lazy" draggable="false" />
      </div>
      ${owned > 0 ? `<span class="own">×${owned}</span>` : ''}
      <div class="meta">
        <div class="name">${esc(info.name)}</div>
        <div class="tagline">
          <span class="jdot" style="background:${color}"></span>${esc(info.cat)} · ${fmtBytes(info.b)}
        </div>
      </div>
    </button>`;
  }

  // ------------------------------------------------------------ hotbar

  private async activateItem(id: string) {
    if (this.game.placer.activeId === id) {
      this.game.stopPlacing();
      return;
    }
    await this.game.selectPlace(id);
  }

  selectHotbar(i: number) {
    const id = this.hotbarIds()[i];
    if (!id) return;
    sfx.unlock();
    sfx.click();
    void this.activateItem(id);
  }

  // ------------------------------------------------------------ modal

  showDetail(id: string) {
    const info = getAsset(id);
    if (!info) return;
    const inv = this.game.mats;
    const affordable = trySpend(inv, info.cost) !== null;
    const raw = expandToRaw(info.cost);
    const missing: Cost = {};
    for (const [k, v] of costList(raw)) {
      const lack = v - (inv[k] ?? 0);
      if (lack > 0) missing[k] = lack;
    }
    const owned = this.game.props[id] ?? 0;
    const placed = this.game.placed.filter((p) => p.id === id).length;
    const dims = [0, 1, 2].map((i) => Math.max(0, info.max[i] - info.min[i]));
    const costChips = costList(info.cost).map(([k, v]) => this.chip(k, v)).join('');
    const stats = [
      `<span class="stat">${dims.map((d) => d.toFixed(2)).join(' × ')} m</span>`,
      `<span class="stat">${fmtBytes(info.b)}</span>`,
      `<span class="stat">${fmtNum(info.t)} tris</span>`,
      `<span class="stat">${info.d} draw${info.d === 1 ? '' : 's'}</span>`,
      info.j > 0 ? `<span class="stat">${info.j} joints</span>` : '',
      info.local ? '<span class="stat hi">Bundled</span>' : '<span class="stat">Streamed from HF</span>',
    ]
      .filter(Boolean)
      .join('');

    this.el.modal.innerHTML = `<div class="modal-card">
      <div class="detail">
        <div class="detail-art">
          <img src="${esc(info.thumb)}" alt="${esc(info.name)}" loading="eager" />
        </div>
        <div class="detail-info">
          <button class="detail-close" data-close title="Close (Esc)" aria-label="Close">✕</button>
          <div class="kicker">${esc(info.cat)} · Tier ${info.tier}</div>
          <h3>${esc(info.name)}</h3>
          <div class="detail-id">${esc(info.id)}</div>
          <div class="stat-row">${stats}</div>
          <div class="section-label">Fabrication cost</div>
          <div class="detail-cost">${costChips}</div>
          <div class="rawline">
            ${affordable
              ? `<span class="ok">Stock covered</span> · ${esc(describeCost(raw))} in raw materials`
              : `<span class="warn">Missing ${esc(describeCost(missing))}</span> · ${esc(describeCost(raw))} total`
            }
          </div>
          <div class="owned-line">Owned <b>${owned}</b> · placed ${placed} · ${info.local ? 'bundled asset' : 'streamed on demand'}</div>
          <div class="detail-actions">
            <button class="primary-btn" data-fab="${esc(id)}">Fabricate</button>
            <button class="ghost-btn" data-fab-place="${esc(id)}">Fabricate + place</button>
            ${owned > 0 ? `<button class="ghost-btn" data-place="${esc(id)}">Place owned</button>` : ''}
          </div>
          <a class="src-link" href="${HF_BLOB}/glb/${encodeURIComponent(id)}.glb" target="_blank" rel="noreferrer">
            Source GLB on Hugging Face ↗
          </a>
        </div>
      </div>
    </div>`;
    this.el.modal.classList.add('open');
    this.el.modal.setAttribute('aria-hidden', 'false');
    this.bindImages(this.el.modal);
  }

  showHelp() {
    const s = this.game.stats;
    const harvested = Object.values(s.harvested).reduce((a, b) => a + b, 0);
    const stats = [
      `<span class="stat">${harvested} gathered</span>`,
      `<span class="stat">${s.refined} refined</span>`,
      `<span class="stat">${s.crafted} fabricated</span>`,
      `<span class="stat">${s.placedTotal} placed</span>`,
      `<span class="stat hi">${s.unlocked} unlocked</span>`,
    ].join('');

    this.el.modal.innerHTML = `<div class="modal-card">
      <div class="panel-head">
        <div>
          <h2>Field manual</h2>
          <div class="sub">Forge World · SimReady sandbox</div>
        </div>
        <button class="close" data-close title="Close (Esc)" aria-label="Close">✕</button>
      </div>
      <div class="help-wrap">
        <div class="help-grid">
          <kbd>W A S D</kbd><span>Walk the island — hold <b>Shift</b> to sprint</span>
          <kbd>Space</kbd><span>Jump · step up onto low props</span>
          <kbd>Drag</kbd><span>Orbit the camera · wheel to zoom</span>
          <kbd>E</kbd><span>Gather from the nearest tree, rock, scrap, drum, crystal or terminal</span>
          <kbd>C</kbd><span>Open the fabricator (Refine / Build / Library)</span>
          <kbd>B</kbd><span>Toggle build mode and the placement grid</span>
          <kbd>R</kbd><span>Rotate the ghost while placing</span>
          <kbd>1 – 8</kbd><span>Select a hotbar prop · click again to cancel</span>
          <kbd>X</kbd><span>Recover a placed prop under the cursor</span>
          <kbd>H</kbd><span>This manual</span>
          <kbd>Esc</kbd><span>Close modal, placement or panel</span>
        </div>
        <div class="stat-row help-stats">${stats}</div>
        <div class="help-note">
          Your island autosaves to this browser every 15 seconds. All 2,595 assets are real
          <b>NVIDIA SimReady</b> models, converted to meshopt + WebP GLB by
          <a href="https://huggingface.co/datasets/codepawl/simready-glb" target="_blank" rel="noreferrer">simready-glb</a>.<br />
          Place a prop, walk away, come back — it will still be there.
        </div>
        ${this.buildAuthHtml()}
        <div class="help-actions">
          <button class="primary-btn" data-close>Back to the island</button>
          <button class="ghost-btn" data-act="reset">Reset world</button>
        </div>
      </div>
    </div>`;
    this.el.modal.classList.add('open');
    this.el.modal.setAttribute('aria-hidden', 'false');
  }

  private buildAuthHtml(): string {
    return `<div class="build-auth">
      <span class="auth-seal">${esc(BUILD.seal)}</span>
      <span class="auth-copy">
        <strong>Build authorized to ${esc(BUILD.author)}</strong>
        <span>${esc(BUILD.label)} · ${esc(BUILD.id)}</span>
      </span>
      <a class="auth-link" href="${BUILD.site}" target="_blank" rel="noreferrer">${esc(BUILD.siteLabel)} ↗</a>
    </div>`;
  }

  private onModalClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t === this.el.modal) {
      this.closeModal();
      return;
    }
    if (t.closest('[data-close]')) {
      this.closeModal();
      sfx.click();
      return;
    }
    const fab = t.closest<HTMLElement>('[data-fab]')?.dataset.fab;
    if (fab) {
      if (this.game.fabricate(fab)) this.showDetail(fab);
      return;
    }
    const fabPlace = t.closest<HTMLElement>('[data-fab-place]')?.dataset.fabPlace;
    if (fabPlace) {
      void this.game.fabricateAndPlace(fabPlace);
      return;
    }
    const place = t.closest<HTMLElement>('[data-place]')?.dataset.place;
    if (place) {
      this.closeModal();
      void this.game.selectPlace(place);
      return;
    }
    if (t.closest('[data-act="reset"]')) {
      if (window.confirm('Erase this island and start a fresh world?')) this.game.resetWorld();
    }
  }

  // ------------------------------------------------------------ feedback

  toast(text: string, kind: ToastKind = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.el.toasts.append(el);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstElementChild?.remove();
    window.setTimeout(() => {
      el.classList.add('out');
      window.setTimeout(() => el.remove(), 380);
    }, 2400);
  }

  floater(text: string, pos3: THREE.Vector3) {
    const v = pos3.clone().project(this.game.camera);
    if (v.z > 1) return;
    const el = document.createElement('div');
    el.className = 'floater';
    el.textContent = text;
    el.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth}px`;
    el.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`;
    el.addEventListener('animationend', () => el.remove(), { once: true });
    this.el.floaters.append(el);
  }

  // ------------------------------------------------------------ tick

  tick(dt: number) {
    this.clockAcc += dt;
    if (this.clockAcc < 0.2) return;
    this.clockAcc = 0;
    this.setClock();
  }

  private setClock() {
    if (!this.clockEl) return;
    const tod = ((this.game.timeOfDay % 1) + 1) % 1;
    const total = Math.floor(tod * 24 * 60);
    const h = Math.floor(total / 60) % 24;
    const m = total % 60;
    const day = tod > 0.25 && tod < 0.75;
    this.clockEl.innerHTML = `<span class="sky">${day ? '☀' : '☾'}</span>${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
