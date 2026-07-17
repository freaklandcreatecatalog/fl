/**
 * Конфиг политической карты Freakland.
 *
 * Картинка карты — assets/political-map.jpg.
 * Для каждого города region — полигон в процентах от размера картинки (0–100),
 * обведён по контуру региона на самой карте.
 * Можно временно включить DEBUG_CITY_OUTLINES в political-map.js, чтобы видеть зоны.
 */

export const MAP_IMAGE = "assets/political-map.jpg";

export const CITIES = [
  {
    id: "nasrali",
    name: "Насрали",
    color: "#e8a0a0",
    region: [
      [19.34, 11.22],
      [19.26, 14.23],
      [17.15, 19.25],
      [2.42, 19.25],
      [3.4, 15.07],
      [6.52, 9.91],
      [13.79, 7.32],
    ],
  },
  {
    id: "zavoz",
    name: "Завоз",
    color: "#ee1111",
    region: [
      [46.21, 15.82],
      [46.21, 22.16],
      [43.87, 30.66],
      [31.45, 30.56],
      [28.95, 27.0],
      [29.38, 24.32],
      [33.12, 20.14],
      [42.97, 14.93],
    ],
  },
  {
    id: "kiaz3dnya",
    name: "Кия за 3 дня",
    color: "#f01144",
    region: [
      [59.3, 30.94],
      [40.62, 32.72],
      [40.16, 17.61],
      [42.46, 15.12],
      [45.59, 15.07],
      [57.23, 23.38],
      [59.18, 27.32],
    ],
  },
  {
    id: "nubsiti",
    name: "Нуб-Сити",
    color: "#b04422",
    region: [
      [76.29, 16.53],
      [76.17, 29.86],
      [69.02, 33.47],
      [61.25, 32.72],
      [58.16, 31.13],
      [59.3, 25.26],
      [65.66, 15.02],
      [74.22, 15.12],
    ],
  },
  {
    id: "verhgolovka",
    name: "Верхняя головка",
    color: "#c052e0",
    region: [
      [86.95, 12.49],
      [87.54, 17.61],
      [85.12, 34.18],
      [83.83, 35.49],
      [79.3, 35.49],
      [77.66, 32.21],
      [75.2, 20.42],
      [77.34, 14.79],
      [83.71, 12.39],
    ],
  },
  {
    id: "ptu",
    name: "ПТУ",
    color: "#800e0e",
    region: [
      [97.03, 44.98],
      [84.92, 51.69],
      [82.46, 51.6],
      [82.46, 37.09],
      [85.16, 34.55],
      [90.66, 35.59],
      [96.52, 39.81],
    ],
  },
  {
    id: "kiska",
    name: "Киска",
    color: "#e040d0",
    region: [
      [51.09, 43.71],
      [47.77, 47.79],
      [43.91, 47.98],
      [36.91, 42.35],
      [35.2, 36.76],
      [40.55, 32.16],
      [44.34, 31.83],
      [51.09, 38.64],
    ],
  },
  {
    id: "smurf",
    name: "Смурф",
    color: "#101080",
    region: [
      [38.4, 43.24],
      [38.95, 47.18],
      [37.46, 49.72],
      [36.84, 50.14],
      [32.85, 50.23],
      [33.01, 45.26],
    ],
  },
  {
    id: "aisuka",
    name: "Айсука",
    color: "#30d020",
    region: [
      [48.55, 54.6],
      [48.55, 62.91],
      [45.31, 69.91],
      [26.91, 69.91],
      [26.95, 58.4],
      [28.63, 55.63],
    ],
  },
  {
    id: "gorod_urodov",
    name: "Город уродов",
    color: "#e09040",
    region: [
      [66.8, 67.61],
      [61.8, 67.32],
      [57.34, 59.3],
      [57.34, 54.6],
      [67.73, 54.6],
      [69.53, 57.79],
    ],
  },
  {
    id: "svalka",
    name: "Свалка",
    color: "#c08878",
    region: [
      [13.01, 69.91],
      [3.09, 69.91],
      [0.12, 57.75],
      [2.54, 50.7],
      [9.14, 50.61],
      [14.57, 62.91],
    ],
  },
];

export function getCityById(id) {
  return CITIES.find((city) => city.id === id) || null;
}

export function getCityOptionsHtml(selectedId = "") {
  const options = ['<option value="">— город не указан —</option>'];
  CITIES.forEach((city) => {
    const selected = city.id === selectedId ? " selected" : "";
    options.push(`<option value="${city.id}"${selected}>${city.name}</option>`);
  });
  return options.join("");
}

/**
 * Применяет админские правки (имя/цвет/контур) поверх базового списка городов.
 * overrides: { [cityId]: { name?, color?, region? } }
 */
export function applyCityOverrides(overrides = {}) {
  return CITIES.map((city) => {
    const patch = overrides[city.id];
    if (!patch) return city;
    return {
      ...city,
      name: patch.name || city.name,
      color: patch.color || city.color,
      region: Array.isArray(patch.region) && patch.region.length >= 3 ? patch.region : city.region,
    };
  });
}