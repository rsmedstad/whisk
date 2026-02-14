// Imperial ⇄ Metric conversion

interface ConversionRule {
  from: string;
  to: string;
  factor: number;
}

const VOLUME_CONVERSIONS: ConversionRule[] = [
  { from: "cup", to: "mL", factor: 236.588 },
  { from: "cups", to: "mL", factor: 236.588 },
  { from: "tbsp", to: "mL", factor: 14.787 },
  { from: "tablespoon", to: "mL", factor: 14.787 },
  { from: "tablespoons", to: "mL", factor: 14.787 },
  { from: "tsp", to: "mL", factor: 4.929 },
  { from: "teaspoon", to: "mL", factor: 4.929 },
  { from: "teaspoons", to: "mL", factor: 4.929 },
  { from: "fl oz", to: "mL", factor: 29.574 },
  { from: "quart", to: "L", factor: 0.946 },
  { from: "quarts", to: "L", factor: 0.946 },
  { from: "gallon", to: "L", factor: 3.785 },
  { from: "gallons", to: "L", factor: 3.785 },
  { from: "pint", to: "mL", factor: 473.176 },
  { from: "pints", to: "mL", factor: 473.176 },
];

const WEIGHT_CONVERSIONS: ConversionRule[] = [
  { from: "oz", to: "g", factor: 28.35 },
  { from: "ounce", to: "g", factor: 28.35 },
  { from: "ounces", to: "g", factor: 28.35 },
  { from: "lb", to: "kg", factor: 0.454 },
  { from: "lbs", to: "kg", factor: 0.454 },
  { from: "pound", to: "kg", factor: 0.454 },
  { from: "pounds", to: "kg", factor: 0.454 },
];

const TEMP_PATTERN = /(\d+)\s*°?\s*F/g;

const ALL_CONVERSIONS = [...VOLUME_CONVERSIONS, ...WEIGHT_CONVERSIONS];

function roundSensible(value: number, unit: string): string {
  // Round to sensible precision for the unit
  if (unit === "mL") {
    if (value < 15) return Math.round(value).toString();
    if (value < 100) return (Math.round(value / 5) * 5).toString();
    return (Math.round(value / 10) * 10).toString();
  }
  if (unit === "L") {
    return (Math.round(value * 10) / 10).toString();
  }
  if (unit === "g") {
    if (value < 10) return Math.round(value).toString();
    if (value < 100) return (Math.round(value / 5) * 5).toString();
    return (Math.round(value / 10) * 10).toString();
  }
  if (unit === "kg") {
    return (Math.round(value * 100) / 100).toString();
  }
  return Math.round(value * 100) / 100 + "";
}

export function convertUnit(
  amount: number,
  fromUnit: string
): { amount: string; unit: string } | null {
  const lower = fromUnit.toLowerCase().trim();
  const rule = ALL_CONVERSIONS.find((c) => c.from === lower);
  if (!rule) return null;

  const converted = amount * rule.factor;
  return {
    amount: roundSensible(converted, rule.to),
    unit: rule.to,
  };
}

export function convertTemperatureInText(text: string): string {
  return text.replace(TEMP_PATTERN, (_, f: string) => {
    const celsius = Math.round(((parseInt(f) - 32) * 5) / 9);
    return `${celsius}°C`;
  });
}

export function isConvertibleUnit(unit: string): boolean {
  return ALL_CONVERSIONS.some((c) => c.from === unit.toLowerCase().trim());
}
