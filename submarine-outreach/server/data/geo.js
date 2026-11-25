// All 50 states + DC. Cities are ordered by business density so a nationwide
// sweep covers the biggest markets in every state before going deeper.
// `tz` is the state's primary IANA timezone, used to send during local business hours.
export const STATES = [
  { code: 'AL', name: 'Alabama', tz: 'America/Chicago', cities: ['Birmingham', 'Huntsville', 'Montgomery', 'Mobile', 'Tuscaloosa'] },
  { code: 'AK', name: 'Alaska', tz: 'America/Anchorage', cities: ['Anchorage', 'Fairbanks', 'Juneau'] },
  { code: 'AZ', name: 'Arizona', tz: 'America/Phoenix', cities: ['Phoenix', 'Tucson', 'Scottsdale', 'Mesa', 'Tempe', 'Flagstaff'] },
  { code: 'AR', name: 'Arkansas', tz: 'America/Chicago', cities: ['Little Rock', 'Fayetteville', 'Bentonville', 'Fort Smith'] },
  { code: 'CA', name: 'California', tz: 'America/Los_Angeles', cities: ['Los Angeles', 'San Francisco', 'San Diego', 'San Jose', 'Sacramento', 'Oakland', 'Irvine', 'Fresno', 'Pasadena', 'Santa Barbara'] },
  { code: 'CO', name: 'Colorado', tz: 'America/Denver', cities: ['Denver', 'Colorado Springs', 'Boulder', 'Fort Collins', 'Aurora'] },
  { code: 'CT', name: 'Connecticut', tz: 'America/New_York', cities: ['Hartford', 'New Haven', 'Stamford', 'Bridgeport', 'Greenwich'] },
  { code: 'DE', name: 'Delaware', tz: 'America/New_York', cities: ['Wilmington', 'Dover', 'Newark'] },
  { code: 'DC', name: 'District of Columbia', tz: 'America/New_York', cities: ['Washington'] },
  { code: 'FL', name: 'Florida', tz: 'America/New_York', cities: ['Miami', 'Orlando', 'Tampa', 'Jacksonville', 'Fort Lauderdale', 'St. Petersburg', 'Tallahassee', 'Boca Raton', 'Naples'] },
  { code: 'GA', name: 'Georgia', tz: 'America/New_York', cities: ['Atlanta', 'Savannah', 'Augusta', 'Athens', 'Alpharetta'] },
  { code: 'HI', name: 'Hawaii', tz: 'Pacific/Honolulu', cities: ['Honolulu', 'Hilo', 'Kailua'] },
  { code: 'ID', name: 'Idaho', tz: 'America/Boise', cities: ['Boise', 'Idaho Falls', "Coeur d'Alene", 'Nampa'] },
  { code: 'IL', name: 'Illinois', tz: 'America/Chicago', cities: ['Chicago', 'Naperville', 'Springfield', 'Peoria', 'Evanston', 'Schaumburg'] },
  { code: 'IN', name: 'Indiana', tz: 'America/Indiana/Indianapolis', cities: ['Indianapolis', 'Fort Wayne', 'Bloomington', 'Carmel', 'South Bend'] },
  { code: 'IA', name: 'Iowa', tz: 'America/Chicago', cities: ['Des Moines', 'Cedar Rapids', 'Iowa City', 'Davenport'] },
  { code: 'KS', name: 'Kansas', tz: 'America/Chicago', cities: ['Wichita', 'Overland Park', 'Kansas City', 'Lawrence', 'Topeka'] },
  { code: 'KY', name: 'Kentucky', tz: 'America/New_York', cities: ['Louisville', 'Lexington', 'Bowling Green', 'Covington'] },
  { code: 'LA', name: 'Louisiana', tz: 'America/Chicago', cities: ['New Orleans', 'Baton Rouge', 'Lafayette', 'Shreveport'] },
  { code: 'ME', name: 'Maine', tz: 'America/New_York', cities: ['Portland', 'Bangor', 'Augusta'] },
  { code: 'MD', name: 'Maryland', tz: 'America/New_York', cities: ['Baltimore', 'Bethesda', 'Annapolis', 'Rockville', 'Columbia'] },
  { code: 'MA', name: 'Massachusetts', tz: 'America/New_York', cities: ['Boston', 'Cambridge', 'Worcester', 'Springfield', 'Newton'] },
  { code: 'MI', name: 'Michigan', tz: 'America/Detroit', cities: ['Detroit', 'Grand Rapids', 'Ann Arbor', 'Lansing', 'Troy'] },
  { code: 'MN', name: 'Minnesota', tz: 'America/Chicago', cities: ['Minneapolis', 'St. Paul', 'Rochester', 'Duluth', 'Bloomington'] },
  { code: 'MS', name: 'Mississippi', tz: 'America/Chicago', cities: ['Jackson', 'Gulfport', 'Hattiesburg', 'Oxford'] },
  { code: 'MO', name: 'Missouri', tz: 'America/Chicago', cities: ['Kansas City', 'St. Louis', 'Springfield', 'Columbia'] },
  { code: 'MT', name: 'Montana', tz: 'America/Denver', cities: ['Billings', 'Missoula', 'Bozeman', 'Helena'] },
  { code: 'NE', name: 'Nebraska', tz: 'America/Chicago', cities: ['Omaha', 'Lincoln', 'Grand Island'] },
  { code: 'NV', name: 'Nevada', tz: 'America/Los_Angeles', cities: ['Las Vegas', 'Reno', 'Henderson'] },
  { code: 'NH', name: 'New Hampshire', tz: 'America/New_York', cities: ['Manchester', 'Portsmouth', 'Nashua', 'Concord'] },
  { code: 'NJ', name: 'New Jersey', tz: 'America/New_York', cities: ['Newark', 'Jersey City', 'Princeton', 'Hoboken', 'Morristown', 'Trenton'] },
  { code: 'NM', name: 'New Mexico', tz: 'America/Denver', cities: ['Albuquerque', 'Santa Fe', 'Las Cruces'] },
  { code: 'NY', name: 'New York', tz: 'America/New_York', cities: ['New York', 'Brooklyn', 'Buffalo', 'Rochester', 'Albany', 'Syracuse', 'White Plains', 'Long Island City'] },
  { code: 'NC', name: 'North Carolina', tz: 'America/New_York', cities: ['Charlotte', 'Raleigh', 'Durham', 'Greensboro', 'Asheville', 'Wilmington'] },
  { code: 'ND', name: 'North Dakota', tz: 'America/Chicago', cities: ['Fargo', 'Bismarck', 'Grand Forks'] },
  { code: 'OH', name: 'Ohio', tz: 'America/New_York', cities: ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo', 'Akron', 'Dayton'] },
  { code: 'OK', name: 'Oklahoma', tz: 'America/Chicago', cities: ['Oklahoma City', 'Tulsa', 'Norman', 'Edmond'] },
  { code: 'OR', name: 'Oregon', tz: 'America/Los_Angeles', cities: ['Portland', 'Eugene', 'Salem', 'Bend'] },
  { code: 'PA', name: 'Pennsylvania', tz: 'America/New_York', cities: ['Philadelphia', 'Pittsburgh', 'Harrisburg', 'Allentown', 'Lancaster', 'State College'] },
  { code: 'RI', name: 'Rhode Island', tz: 'America/New_York', cities: ['Providence', 'Newport', 'Warwick'] },
  { code: 'SC', name: 'South Carolina', tz: 'America/New_York', cities: ['Charleston', 'Columbia', 'Greenville', 'Myrtle Beach'] },
  { code: 'SD', name: 'South Dakota', tz: 'America/Chicago', cities: ['Sioux Falls', 'Rapid City'] },
  { code: 'TN', name: 'Tennessee', tz: 'America/Chicago', cities: ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga', 'Franklin'] },
  { code: 'TX', name: 'Texas', tz: 'America/Chicago', cities: ['Houston', 'Dallas', 'Austin', 'San Antonio', 'Fort Worth', 'Plano', 'El Paso', 'The Woodlands', 'Frisco'] },
  { code: 'UT', name: 'Utah', tz: 'America/Denver', cities: ['Salt Lake City', 'Provo', 'Ogden', 'St. George'] },
  { code: 'VT', name: 'Vermont', tz: 'America/New_York', cities: ['Burlington', 'Montpelier', 'Stowe'] },
  { code: 'VA', name: 'Virginia', tz: 'America/New_York', cities: ['Richmond', 'Virginia Beach', 'Arlington', 'Alexandria', 'Norfolk', 'Charlottesville'] },
  { code: 'WA', name: 'Washington', tz: 'America/Los_Angeles', cities: ['Seattle', 'Bellevue', 'Spokane', 'Tacoma', 'Redmond'] },
  { code: 'WV', name: 'West Virginia', tz: 'America/New_York', cities: ['Charleston', 'Morgantown', 'Huntington'] },
  { code: 'WI', name: 'Wisconsin', tz: 'America/Chicago', cities: ['Milwaukee', 'Madison', 'Green Bay', 'Appleton'] },
  { code: 'WY', name: 'Wyoming', tz: 'America/Denver', cities: ['Cheyenne', 'Casper', 'Jackson'] },
];

export const STATE_BY_CODE = Object.fromEntries(STATES.map((s) => [s.code, s]));
const STATE_BY_NAME = Object.fromEntries(STATES.map((s) => [s.name.toLowerCase(), s]));

/** Accepts "TX", "tx", "Texas" → "TX"; returns null when unknown. */
export function normalizeState(value) {
  if (!value) return null;
  const v = String(value).trim();
  if (STATE_BY_CODE[v.toUpperCase()]) return v.toUpperCase();
  return STATE_BY_NAME[v.toLowerCase()]?.code ?? null;
}

export function stateTimezone(code) {
  return STATE_BY_CODE[code]?.tz ?? 'America/New_York';
}
