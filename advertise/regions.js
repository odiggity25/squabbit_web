// States / provinces / regions an advertiser can target, across the countries we
// support for sub-country targeting. Each region's `code` is the ISO 3166-2
// subdivision code that getAdFill resolves a viewer's IP to, and a rule is stored as
// a country-region key (country alpha-2 + '-' + code, e.g. 'US-CA', 'AU-NSW',
// 'GB-ENG', 'IE-L'). The granularity per country is whatever MaxMind/geoip-lite
// actually returns, so a stored key maps directly to who sees the ad:
//   US  -> states (CA, TX, ...)
//   CA  -> provinces/territories (ON, QC, ...)
//   GB  -> the four nations (ENG, SCT, WLS, NIR)
//   IE  -> the four provinces (C, L, M, U)
//   AU  -> states/territories (NSW, VIC, ...)
// Extend with more countries' subdivisions as they're requested.

export const REGION_COUNTRY_NAMES = {
    US: 'United States',
    CA: 'Canada',
    GB: 'United Kingdom',
    IE: 'Ireland',
    AU: 'Australia',
};

// Per-country subdivision lists, each sorted by name.
const BY_COUNTRY = {
    US: [
        ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
        ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
        ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
        ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'],
        ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
        ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'],
        ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
        ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
        ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'],
        ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'],
        ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'],
        ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'],
        ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
    ],
    CA: [
        ['AB', 'Alberta'], ['BC', 'British Columbia'], ['MB', 'Manitoba'], ['NB', 'New Brunswick'],
        ['NL', 'Newfoundland and Labrador'], ['NT', 'Northwest Territories'], ['NS', 'Nova Scotia'],
        ['NU', 'Nunavut'], ['ON', 'Ontario'], ['PE', 'Prince Edward Island'], ['QC', 'Quebec'],
        ['SK', 'Saskatchewan'], ['YT', 'Yukon'],
    ],
    GB: [
        ['ENG', 'England'], ['NIR', 'Northern Ireland'], ['SCT', 'Scotland'], ['WLS', 'Wales'],
    ],
    IE: [
        ['C', 'Connacht'], ['L', 'Leinster'], ['M', 'Munster'], ['U', 'Ulster'],
    ],
    AU: [
        ['ACT', 'Australian Capital Territory'], ['NSW', 'New South Wales'],
        ['NT', 'Northern Territory'], ['QLD', 'Queensland'], ['SA', 'South Australia'],
        ['TAS', 'Tasmania'], ['VIC', 'Victoria'], ['WA', 'Western Australia'],
    ],
};

export const REGIONS = Object.entries(BY_COUNTRY).flatMap(([country, list]) =>
    list.map(([code, name]) => ({
        key: `${country}-${code}`,
        country,
        code,
        name,
        countryName: REGION_COUNTRY_NAMES[country],
    })));

const KEY_TO_REGION = new Map(REGIONS.map((r) => [r.key, r]));

// Display name for a stored country-region key. Falls back to the raw key so an
// unknown/legacy code still renders as a removable chip rather than vanishing.
export function regionName(key) {
    const r = KEY_TO_REGION.get(key);
    return r ? r.name : key;
}

// Country display name for a stored key (for disambiguating the dropdown, since a few
// region names repeat across countries). Empty string when unknown.
export function regionCountryName(key) {
    const r = KEY_TO_REGION.get(key);
    return r ? r.countryName : '';
}
