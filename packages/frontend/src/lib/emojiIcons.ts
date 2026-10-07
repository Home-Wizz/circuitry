import { firstKeyIn } from '@/lib/utils';

/**
 * The colour icons the canvas cards and the When / And / Then pickers show,
 * by icon key: the same keys as lib/domain-icons.ts (a domain, a device
 * class, a trigger or condition type), plus the step kinds and building blocks. Each value
 * is the emoji's code point, the name of its image in assets/emoji (Fluent
 * Emoji, MIT, see THIRD-PARTY-NOTICES.md; only the ones listed here are
 * bundled). One bundled set, so they look the same on
 * every platform. A key not listed keeps its line icon.
 */
export const EMOJI_ICONS: Record<string, string> = {
  // Step kinds and building blocks
  trigger: '26a1', // ⚡
  condition: '1f6a6', // 🚦
  action: '25b6-fe0f', // ▶️
  if_else: '1f500', // 🔀
  choose: '1f39b-fe0f', // 🎛️
  repeat_while: '1f501', // 🔁
  repeat_until: '1f504', // 🔄
  repeat_count: '1f502', // 🔂
  repeat_for_each: '1f4cb', // 📋
  wait: '23f3', // ⏳
  delay: '23f1-fe0f', // ⏱️
  set_variables: '1f9ee', // 🧮
  parallel: '1f6e4-fe0f', // 🛤️
  sequence: '1f4d1', // 📑
  start: '1f680', // 🚀
  join: '1f91d', // 🤝
  stop: '1f6d1', // 🛑
  kept: '1f512', // 🔒
  // Domains
  light: '1f4a1', // 💡
  switch: '1f50c', // 🔌
  cover: '1fa9f', // 🪟
  fan: 'custom-fan', // Circuitry's own (no fan emoji exists)
  climate: '1f321-fe0f', // 🌡️
  water_heater: '1f6bf', // 🚿
  lock: '1f510', // 🔐
  media_player: '1f4fa', // 📺
  vacuum: '1f9f9', // 🧹
  camera: '1f4f7', // 📷
  person: '1f9d1', // 🧑
  device_tracker: '1f4cd', // 📍
  zone: '1f4cd', // 📍
  sensor: '1f4c8', // 📈
  binary_sensor: '1f518', // 🔘
  humidifier: '1f4a6', // 💦
  siren: '1f6a8', // 🚨
  alarm_control_panel: '1f6a8', // 🚨
  remote: '1f4f1', // 📱
  notify: '1f514', // 🔔
  persistent_notification: '1f514', // 🔔
  valve: '1f6b0', // 🚰
  select: '1f4cb', // 📋
  text: '270f-fe0f', // ✏️
  scene: '1f3ac', // 🎬
  counter: '1f522', // 🔢
  todo: '2705', // ✅
  lawn_mower: '1f331', // 🌱
  button: '1f518', // 🔘
  timer: '23f2-fe0f', // ⏲️
  calendar: '1f4c5', // 📅
  sun: '2600-fe0f', // ☀️
  moon: '1f319', // 🌙
  update: '1f504', // 🔄
  ai_task: '2728', // ✨
  conversation: '1f4ac', // 💬
  assist_satellite: '1f399-fe0f', // 🎙️
  date: '1f4c5', // 📅
  datetime: '1f4c5', // 📅
  group: '1f4e6', // 📦
  automation: '1f916', // 🤖
  script: '1f4dc', // 📜
  input_boolean: '1f39a-fe0f', // 🎚️
  input_button: '1f518', // 🔘
  input_datetime: '1f4c5', // 📅
  input_number: '1f39a-fe0f', // 🎚️
  input_select: '1f4cb', // 📋
  input_text: '270f-fe0f', // ✏️
  number: '1f39a-fe0f', // 🎚️
  weather: '26c5', // ⛅
  homeassistant: '1f3e0', // 🏠
  // Device classes
  door: '1f6aa', // 🚪
  garage_door: '1f697', // 🚗
  gate: '1f6aa', // 🚪
  window: '1fa9f', // 🪟
  moisture: '1f4a7', // 💧
  motion: '1f3c3', // 🏃
  occupancy: '1f9cd', // 🧍
  presence: '1f9cd', // 🧍
  vibration: '1f4f3', // 📳
  battery: '1f50b', // 🔋
  humidity: '1f4a7', // 💧
  illuminance: '1f506', // 🔆
  power: '26a1', // ⚡
  temperature: '1f321-fe0f', // 🌡️
  air_quality: '1f32c-fe0f', // 🌬️
  smoke: '1f4a8', // 💨
  gas: '1f4a8', // 💨
  sound: '1f50a', // 🔊
  plug: '1f50c', // 🔌
  // Trigger and condition types without an entity
  time: '1f552', // 🕒
  time_pattern: '1f552', // 🕒
  template: '1f9e9', // 🧩
  event: '1f4e3', // 📣
  mqtt: '1f4e1', // 📡
  webhook: '1fa9d', // 🪝
  tag: '1f3f7-fe0f', // 🏷️
  geo_location: '1f30d', // 🌍
  device: '1f4df', // 📟
  // The pickers' own rows
  devices: '1f4df', // 📟
  device_types: '1f5c2-fe0f', // 🗂️
  non_device: '23f0', // ⏰
  blocks: '1f9f1', // 🧱
  generic: '2728', // ✨
  integration: '1f9e9', // 🧩
  unassigned: '1f4c2', // 📂
  entities: '1f9fe', // 🧾
  helpers: '1f9f0', // 🧰
  services: '1f6e0-fe0f', // 🛠️
};

/** The first of the keys that has a colour icon, most specific first. */
export function stepIconKey(...keys: (string | undefined)[]): string | undefined {
  return firstKeyIn(EMOJI_ICONS, keys);
}
