import categoryPages from './src/lib/public-category-pages.json' with { type: 'json' };

export const cityLocatives = Object.freeze({
  Beograd: 'Beogradu', Kragujevac: 'Kragujevcu', Niš: 'Nišu',
  'Novi Sad': 'Novom Sadu', Pančevo: 'Pančevu', Subotica: 'Subotici', Čačak: 'Čačku',
});
export function cityLocative(city) {
  return typeof city === 'string' ? cityLocatives[city.trim()] ?? null : null;
}
export function cityPhrase(city) {
  const locative = cityLocative(city);
  return locative ? `u ${locative}` : typeof city === 'string' ? city.trim() : '';
}
export function publicImageAlt({ name, category, city, description } = {}) {
  return [name, category, cityPhrase(city), description].filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()).filter((value, index, values) => values.indexOf(value) === index).join(' — ');
}
export function publicSalonCategories(salon) {
  return [...new Set((salon.services ?? []).map(service => service.category).filter(value => typeof value === 'string' && value.trim()))];
}
export function categoryListingHref(category) {
  return categoryPages.find(page => page.apiCategory === category)?.path ?? `/saloni?category=${encodeURIComponent(category)}`;
}