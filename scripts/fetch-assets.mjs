// Downloads the manifest for the web-ready NVIDIA SimReady GLB catalog and a
// curated offline bundle so the game boots instantly without a network round trip.
// Source: https://huggingface.co/datasets/codepawl/simready-glb (CC BY 4.0, models by NVIDIA)
import fs from 'node:fs/promises';
import path from 'node:path';

const REPO = 'codepawl/simready-glb';
const BASE = `https://huggingface.co/datasets/${REPO}/resolve/main`;
const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, 'scripts', '.cache');
const GLB_DIR = path.join(ROOT, 'public', 'assets', 'glb');
const THUMB_DIR = path.join(ROOT, 'public', 'assets', 'thumbs');
const DATA_DIR = path.join(ROOT, 'public', 'data');

// Curated starter pack: iconic warehouse / workshop / office props that make a
// good first build. Everything else in the 2,595 asset catalog streams on demand.
const CURATED = [
  // storage & logistics
  'pallet_a01', 'pallet_wood_recycled_a05', 'crate_plywood_a04', 'crate_blue_a08',
  'crate_white_a14', 'box_cardboard_a01', 'drum_plastic_blue_a01', 'drum_steel_a01',
  'bin_waste_a01', 'container_recycle_blue_wheeled_a02', 'palletJack_heavyDuty_a01',
  'handTruck_convertible_steel_red_a01',
  // industrial
  'rack_large_empty_a01', 'barrier_fence_metal_a02', 'ladder_step_aluminium_c03',
  'machineGuard_a01', 'conveyor_belt_a05', 'robotic_system_a01',
  'robotic_system_arm_b01', 'robotics_small_bot_a01', 'construction_wheelbarrow_metal_a01',
  'equipment_bench_vise_a01', 'electricalSystem_battery_a01',
  // workshop & office
  'furniture_workbench_modular_a01', 'table_metal_stainless_a03', 'furniture_table_coffee_low_a01',
  'chair_office_amf_black_a01', 'cabinet_file_a01', 'desk_a01',
  'computer_monitor_office_a01', 'computer_keyboard_a01', 'computer_mouse_office_b01',
  'computer_printer_office_a01', 'computer_desktop_tower_a01', 'monitor_a01',
  'lamp_ceiling_50cm_square_a01', 'lighting_taskLight_suspendedLinearBench_a01',
  'sign_warning_a04', 'sign_wetFloor_a01', 'TV_a01', 'book_open_a01',
  'equipment_powerStrip_portable_c01', 'detector_camera_a01',
  // break room
  'appliance_toaster_a01', 'machine_coffee_vending_a01', 'dishware_mug_coffee_a01',
  'dishware_cup_tea_a01', 'food_beverage_can_c01', 'food_beverage_bottledWater_b01',
  'facilityEquipment_beverageFridge_display_a01', 'appliance_refrigerator_a01',
  // tools
  'tool_hammer_a01', 'tool_pliers_a01', 'tools_fireExtinguisher_powder_a01',
  'handTool_wrench_adjustable_a01', 'handTool_screwdriver_phillips_ph2_a01',
  'cleaning_bucket_iron_a01', 'box_glove_a01',
];

const log = (...a) => console.log('[assets]', ...a);

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, buf);
  return buf.length;
}

async function manifest() {
  const cached = path.join(CACHE, 'manifest.jsonl');
  try {
    const txt = await fs.readFile(cached, 'utf8');
    log(`manifest cached (${(txt.length / 1024).toFixed(0)} KB)`);
    return txt.trim().split('\n').map((l) => JSON.parse(l));
  } catch {
    log('downloading manifest…');
    const res = await fetch(`${BASE}/manifest.jsonl`);
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    const txt = await res.text();
    await fs.mkdir(CACHE, { recursive: true });
    await fs.writeFile(cached, txt);
    return txt.trim().split('\n').map((l) => JSON.parse(l));
  }
}

async function main() {
  const rows = await manifest();
  log(`${rows.length} assets in catalog`);

  await fs.mkdir(DATA_DIR, { recursive: true });
  const catalog = rows.map((r) => ({
    id: r.asset,
    b: r.optimized.bytes,
    t: r.optimized.triangles,
    j: r.physics?.joints ?? 0,
    d: r.optimized.drawCalls ?? 0,
    min: (r.bounds?.min ?? [0, 0, 0]).map((n) => +n.toFixed(2)),
    max: (r.bounds?.max ?? [1, 1, 1]).map((n) => +n.toFixed(2)),
  }));
  await fs.writeFile(path.join(DATA_DIR, 'catalog.json'), JSON.stringify(catalog));
  log(`wrote public/data/catalog.json (${(JSON.stringify(catalog).length / 1024).toFixed(0)} KB)`);

  const known = new Set(rows.map((r) => r.asset));
  const missing = CURATED.filter((id) => !known.has(id));
  if (missing.length) log('!! not in catalog:', missing.join(', '));
  const list = CURATED.filter((id) => known.has(id));

  let total = 0;
  const local = [];
  for (const id of list) {
    const glb = path.join(GLB_DIR, `${id}.glb`);
    const thumb = path.join(THUMB_DIR, `${id}.webp`);
    let bytes = 0;
    try {
      bytes = (await fs.stat(glb)).size;
    } catch {
      try {
        bytes = await download(`${BASE}/glb/${id}.glb`, glb);
        log(`glb  ${id} (${(bytes / 1024).toFixed(0)} KB)`);
      } catch (e) {
        log(`glb  ${id} FAILED: ${e.message}`);
        continue;
      }
    }
    try {
      await fs.stat(thumb);
    } catch {
      try {
        await download(`${BASE}/thumbs/${id}.webp`, thumb);
      } catch (e) {
        log(`thumb ${id} failed: ${e.message}`);
      }
    }
    total += bytes;
    local.push(id);
  }

  await fs.writeFile(path.join(DATA_DIR, 'local-assets.json'), JSON.stringify(local));
  log(`${local.length} assets bundled, ${(total / 1024 / 1024).toFixed(1)} MB total`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
