export const TARGET_ACCOUNT_SOURCE = {
  label: "2026 U.S. revenue ranking",
  url: "https://us500.com/fortune-1000-companies",
  verifiedAt: "2026-09-10",
};

type TargetAccount = {
  rank: number;
  name: string;
  domain: string;
  revenueUsdBillions: number;
  employees: number;
  vertical: string;
  hqCity: string;
  hqState: string;
};

export const targetAccounts: TargetAccount[] = [
  { rank: 654, name: "CrowdStrike Holdings", domain: "crowdstrike.com", revenueUsdBillions: 4.81, employees: 10700, vertical: "Software", hqCity: "Austin", hqState: "Texas" },
  { rank: 660, name: "SoFi Technologies", domain: "sofi.com", revenueUsdBillions: 4.77, employees: 6100, vertical: "Financial Services", hqCity: "San Francisco", hqState: "California" },
  { rank: 661, name: "Ciena", domain: "ciena.com", revenueUsdBillions: 4.77, employees: 8990, vertical: "Communications Equipment", hqCity: "Hanover", hqState: "Maryland" },
  { rank: 662, name: "Five Below", domain: "fivebelow.com", revenueUsdBillions: 4.76, employees: 16200, vertical: "Specialty Retail", hqCity: "Philadelphia", hqState: "Pennsylvania" },
  { rank: 663, name: "Landstar System", domain: "landstar.com", revenueUsdBillions: 4.76, employees: 1380, vertical: "Ground Transportation", hqCity: "Jacksonville", hqState: "Florida" },
  { rank: 665, name: "Roku", domain: "roku.com", revenueUsdBillions: 4.74, employees: 3600, vertical: "Entertainment", hqCity: "San Jose", hqState: "California" },
  { rank: 666, name: "Flowserve", domain: "flowserve.com", revenueUsdBillions: 4.73, employees: 16000, vertical: "Machinery", hqCity: "Irving", hqState: "Texas" },
  { rank: 667, name: "Elanco Animal Health", domain: "elanco.com", revenueUsdBillions: 4.71, employees: 9650, vertical: "Pharmaceuticals", hqCity: "Indianapolis", hqState: "Indiana" },
  { rank: 668, name: "Cboe Global Markets", domain: "cboe.com", revenueUsdBillions: 4.71, employees: 1660, vertical: "Capital Markets", hqCity: "Chicago", hqState: "Illinois" },
  { rank: 669, name: "SiteOne Landscape Supply", domain: "siteone.com", revenueUsdBillions: 4.70, employees: 7910, vertical: "Distribution", hqCity: "Roswell", hqState: "Georgia" },
  { rank: 671, name: "Hasbro", domain: "hasbro.com", revenueUsdBillions: 4.70, employees: 4520, vertical: "Consumer Products", hqCity: "Pawtucket", hqState: "Rhode Island" },
  { rank: 672, name: "Bread Financial Holdings", domain: "breadfinancial.com", revenueUsdBillions: 4.70, employees: 6000, vertical: "Financial Services", hqCity: "Columbus", hqState: "Ohio" },
  { rank: 674, name: "Grocery Outlet Holding", domain: "groceryoutlet.com", revenueUsdBillions: 4.69, employees: 1930, vertical: "Food Retail", hqCity: "Emeryville", hqState: "California" },
  { rank: 675, name: "Floor & Decor Holdings", domain: "flooranddecor.com", revenueUsdBillions: 4.68, employees: 12100, vertical: "Specialty Retail", hqCity: "Atlanta", hqState: "Georgia" },
  { rank: 676, name: "Snowflake", domain: "snowflake.com", revenueUsdBillions: 4.68, employees: 9060, vertical: "Software", hqCity: "Menlo Park", hqState: "California" },
  { rank: 677, name: "East West Bancorp", domain: "eastwestbank.com", revenueUsdBillions: 4.67, employees: 3350, vertical: "Banking", hqCity: "Pasadena", hqState: "California" },
  { rank: 679, name: "DexCom", domain: "dexcom.com", revenueUsdBillions: 4.66, employees: 11050, vertical: "Medical Devices", hqCity: "San Diego", hqState: "California" },
  { rank: 680, name: "Copart", domain: "copart.com", revenueUsdBillions: 4.65, employees: 13800, vertical: "Automotive Services", hqCity: "Dallas", hqState: "Texas" },
  { rank: 683, name: "Timken", domain: "timken.com", revenueUsdBillions: 4.58, employees: 19000, vertical: "Machinery", hqCity: "North Canton", hqState: "Ohio" },
  { rank: 684, name: "TransUnion", domain: "transunion.com", revenueUsdBillions: 4.58, employees: 13500, vertical: "Financial Services", hqCity: "Chicago", hqState: "Illinois" },
  { rank: 686, name: "Applied Industrial Technologies", domain: "applied.com", revenueUsdBillions: 4.56, employees: 6800, vertical: "Distribution", hqCity: "Cleveland", hqState: "Ohio" },
  { rank: 687, name: "Corpay", domain: "corpay.com", revenueUsdBillions: 4.53, employees: 11800, vertical: "Financial Services", hqCity: "Atlanta", hqState: "Georgia" },
  { rank: 688, name: "Viasat", domain: "viasat.com", revenueUsdBillions: 4.52, employees: 7000, vertical: "Communications Equipment", hqCity: "Carlsbad", hqState: "California" },
  { rank: 689, name: "Toro", domain: "toro.com", revenueUsdBillions: 4.51, employees: 9230, vertical: "Machinery", hqCity: "Bloomington", hqState: "Minnesota" },
  { rank: 690, name: "CNO Financial Group", domain: "cnoinc.com", revenueUsdBillions: 4.49, employees: 3300, vertical: "Insurance", hqCity: "Carmel", hqState: "Indiana" },
  { rank: 691, name: "HEICO", domain: "heico.com", revenueUsdBillions: 4.49, employees: 11100, vertical: "Aerospace & Defense", hqCity: "Hollywood", hqState: "Florida" },
  { rank: 692, name: "V2X", domain: "gov2x.com", revenueUsdBillions: 4.48, employees: 16200, vertical: "Aerospace & Defense", hqCity: "Reston", hqState: "Virginia" },
  { rank: 693, name: "Palantir Technologies", domain: "palantir.com", revenueUsdBillions: 4.48, employees: 4430, vertical: "Software", hqCity: "Aventura", hqState: "Florida" },
  { rank: 694, name: "Harley-Davidson", domain: "harley-davidson.com", revenueUsdBillions: 4.47, employees: 5500, vertical: "Manufacturing", hqCity: "Milwaukee", hqState: "Wisconsin" },
  { rank: 695, name: "Robinhood Markets", domain: "robinhood.com", revenueUsdBillions: 4.47, employees: 2900, vertical: "Financial Services", hqCity: "Menlo Park", hqState: "California" },
  { rank: 698, name: "Granite Construction", domain: "graniteconstruction.com", revenueUsdBillions: 4.42, employees: 4150, vertical: "Construction & Engineering", hqCity: "Watsonville", hqState: "California" },
  { rank: 699, name: "Webster Financial", domain: "websterbank.com", revenueUsdBillions: 4.42, employees: 4550, vertical: "Banking", hqCity: "Stamford", hqState: "Connecticut" },
  { rank: 701, name: "Microchip Technology", domain: "microchip.com", revenueUsdBillions: 4.40, employees: 19400, vertical: "Semiconductors", hqCity: "Chandler", hqState: "Arizona" },
  { rank: 702, name: "EquipmentShare", domain: "equipmentshare.com", revenueUsdBillions: 4.38, employees: 8210, vertical: "Equipment Services", hqCity: "Columbia", hqState: "Missouri" },
  { rank: 703, name: "Herc Holdings", domain: "hercrentals.com", revenueUsdBillions: 4.38, employees: 9600, vertical: "Equipment Services", hqCity: "Bonita Springs", hqState: "Florida" },
  { rank: 704, name: "Opendoor Technologies", domain: "opendoor.com", revenueUsdBillions: 4.37, employees: 1040, vertical: "Real Estate Technology", hqCity: "Tempe", hqState: "Arizona" },
  { rank: 707, name: "Acuity", domain: "acuityinc.com", revenueUsdBillions: 4.35, employees: 13800, vertical: "Electrical Equipment", hqCity: "Atlanta", hqState: "Georgia" },
  { rank: 708, name: "Illumina", domain: "illumina.com", revenueUsdBillions: 4.34, employees: 9340, vertical: "Life Sciences", hqCity: "San Diego", hqState: "California" },
  { rank: 709, name: "Dream Finders Homes", domain: "dreamfindershomes.com", revenueUsdBillions: 4.32, employees: 1910, vertical: "Homebuilding", hqCity: "Jacksonville", hqState: "Florida" },
  { rank: 710, name: "Service Corporation International", domain: "sci-corp.com", revenueUsdBillions: 4.31, employees: 21530, vertical: "Consumer Services", hqCity: "Houston", hqState: "Texas" },
  { rank: 711, name: "IDEXX Laboratories", domain: "idexx.com", revenueUsdBillions: 4.30, employees: 11000, vertical: "Medical Devices", hqCity: "Westbrook", hqState: "Maine" },
  { rank: 712, name: "PennyMac Financial Services", domain: "pennymac.com", revenueUsdBillions: 4.28, employees: 5240, vertical: "Financial Services", hqCity: "Westlake Village", hqState: "California" },
  { rank: 714, name: "Kelly Services", domain: "kellyservices.com", revenueUsdBillions: 4.25, employees: 4900, vertical: "Professional Services", hqCity: "Troy", hqState: "Michigan" },
  { rank: 715, name: "Euronet Worldwide", domain: "euronetworldwide.com", revenueUsdBillions: 4.24, employees: 10800, vertical: "Financial Services", hqCity: "Leawood", hqState: "Kansas" },
  { rank: 716, name: "Lincoln Electric Holdings", domain: "lincolnelectric.com", revenueUsdBillions: 4.23, employees: 12000, vertical: "Machinery", hqCity: "Cleveland", hqState: "Ohio" },
  { rank: 718, name: "Pinterest", domain: "pinterest.com", revenueUsdBillions: 4.22, employees: 5260, vertical: "Internet Services", hqCity: "San Francisco", hqState: "California" },
  { rank: 719, name: "Generac Holdings", domain: "generac.com", revenueUsdBillions: 4.21, employees: 9400, vertical: "Electrical Equipment", hqCity: "Waukesha", hqState: "Wisconsin" },
  { rank: 720, name: "Akamai Technologies", domain: "akamai.com", revenueUsdBillions: 4.21, employees: 11380, vertical: "Cloud Infrastructure", hqCity: "Cambridge", hqState: "Massachusetts" },
  { rank: 721, name: "Shift4 Payments", domain: "shift4.com", revenueUsdBillions: 4.18, employees: 6300, vertical: "Financial Services", hqCity: "Center Valley", hqState: "Pennsylvania" },
  { rank: 724, name: "Fortive", domain: "fortive.com", revenueUsdBillions: 4.16, employees: 10000, vertical: "Industrial Technology", hqCity: "Everett", hqState: "Washington" },
  { rank: 731, name: "Hologic", domain: "hologic.com", revenueUsdBillions: 4.10, employees: 7070, vertical: "Medical Devices", hqCity: "Marlborough", hqState: "Massachusetts" },
  { rank: 733, name: "Boyd Gaming", domain: "boydgaming.com", revenueUsdBillions: 4.09, employees: 16010, vertical: "Hospitality", hqCity: "Las Vegas", hqState: "Nevada" },
  { rank: 735, name: "SkyWest", domain: "skywest.com", revenueUsdBillions: 4.06, employees: 14800, vertical: "Airlines", hqCity: "St. George", hqState: "Utah" },
  { rank: 737, name: "Western Union", domain: "westernunion.com", revenueUsdBillions: 4.05, employees: 9600, vertical: "Financial Services", hqCity: "Denver", hqState: "Colorado" },
  { rank: 738, name: "Crocs", domain: "crocs.com", revenueUsdBillions: 4.04, employees: 8010, vertical: "Consumer Products", hqCity: "Broomfield", hqState: "Colorado" },
  { rank: 739, name: "Align Technology", domain: "aligntech.com", revenueUsdBillions: 4.04, employees: 20290, vertical: "Medical Devices", hqCity: "Tempe", hqState: "Arizona" },
  { rank: 741, name: "Mettler-Toledo International", domain: "mt.com", revenueUsdBillions: 4.03, employees: 17350, vertical: "Scientific Instruments", hqCity: "Columbus", hqState: "Ohio" },
  { rank: 742, name: "Travel + Leisure", domain: "travelandleisureco.com", revenueUsdBillions: 4.02, employees: 19300, vertical: "Hospitality", hqCity: "Orlando", hqState: "Florida" },
  { rank: 743, name: "Charles River Laboratories", domain: "criver.com", revenueUsdBillions: 4.02, employees: 19000, vertical: "Life Sciences", hqCity: "Wilmington", hqState: "Massachusetts" },
  { rank: 744, name: "ArcBest", domain: "arcb.com", revenueUsdBillions: 4.01, employees: 14000, vertical: "Logistics", hqCity: "Fort Smith", hqState: "Arkansas" },
  { rank: 749, name: "Bloomin' Brands", domain: "bloominbrands.com", revenueUsdBillions: 3.96, employees: 64000, vertical: "Restaurants", hqCity: "Tampa", hqState: "Florida" },
  { rank: 751, name: "Alignment Healthcare", domain: "alignmenthealth.com", revenueUsdBillions: 3.95, employees: 1850, vertical: "Healthcare Services", hqCity: "Orange", hqState: "California" },
  { rank: 753, name: "ITT", domain: "itt.com", revenueUsdBillions: 3.94, employees: 11600, vertical: "Machinery", hqCity: "Stamford", hqState: "Connecticut" },
  { rank: 754, name: "Gen Digital", domain: "gendigital.com", revenueUsdBillions: 3.94, employees: 3500, vertical: "Software", hqCity: "Tempe", hqState: "Arizona" },
  { rank: 755, name: "Middleby", domain: "middleby.com", revenueUsdBillions: 3.93, employees: 8830, vertical: "Machinery", hqCity: "Elgin", hqState: "Illinois" },
  { rank: 760, name: "Moog", domain: "moog.com", revenueUsdBillions: 3.86, employees: 13500, vertical: "Aerospace & Defense", hqCity: "East Aurora", hqState: "New York" },
  { rank: 763, name: "Diebold Nixdorf", domain: "dieboldnixdorf.com", revenueUsdBillions: 3.81, employees: 20000, vertical: "Technology Hardware", hqCity: "North Canton", hqState: "Ohio" },
  { rank: 764, name: "JBT Marel", domain: "jbtc.com", revenueUsdBillions: 3.80, employees: 11500, vertical: "Machinery", hqCity: "Chicago", hqState: "Illinois" },
  { rank: 765, name: "FTI Consulting", domain: "fticonsulting.com", revenueUsdBillions: 3.79, employees: 8120, vertical: "Professional Services", hqCity: "Washington", hqState: "District of Columbia" },
  { rank: 766, name: "AptarGroup", domain: "aptar.com", revenueUsdBillions: 3.78, employees: 14000, vertical: "Packaging", hqCity: "Crystal Lake", hqState: "Illinois" },
  { rank: 767, name: "MSC Industrial Direct", domain: "mscdirect.com", revenueUsdBillions: 3.77, employees: 7180, vertical: "Distribution", hqCity: "Melville", hqState: "New York" },
  { rank: 770, name: "Rollins", domain: "rollins.com", revenueUsdBillions: 3.76, employees: 21950, vertical: "Commercial Services", hqCity: "Atlanta", hqState: "Georgia" },
  { rank: 771, name: "H&R Block", domain: "hrblock.com", revenueUsdBillions: 3.76, employees: 37200, vertical: "Financial Services", hqCity: "Kansas City", hqState: "Missouri" },
  { rank: 776, name: "Instacart", domain: "instacart.com", revenueUsdBillions: 3.74, employees: 3600, vertical: "Internet Services", hqCity: "San Francisco", hqState: "California" },
  { rank: 778, name: "Hub Group", domain: "hubgroup.com", revenueUsdBillions: 3.73, employees: 6470, vertical: "Logistics", hqCity: "Oak Brook", hqState: "Illinois" },
  { rank: 779, name: "Frontier Group Holdings", domain: "flyfrontier.com", revenueUsdBillions: 3.72, employees: 7660, vertical: "Airlines", hqCity: "Denver", hqState: "Colorado" },
  { rank: 781, name: "Alnylam Pharmaceuticals", domain: "alnylam.com", revenueUsdBillions: 3.71, employees: 2500, vertical: "Pharmaceuticals", hqCity: "Cambridge", hqState: "Massachusetts" },
  { rank: 782, name: "Cabot", domain: "cabotcorp.com", revenueUsdBillions: 3.71, employees: 4060, vertical: "Chemicals", hqCity: "Boston", hqState: "Massachusetts" },
  { rank: 785, name: "Donaldson", domain: "donaldson.com", revenueUsdBillions: 3.69, employees: 15000, vertical: "Machinery", hqCity: "Minneapolis", hqState: "Minnesota" },
  { rank: 786, name: "Dentsply Sirona", domain: "dentsplysirona.com", revenueUsdBillions: 3.68, employees: 14000, vertical: "Medical Devices", hqCity: "Charlotte", hqState: "North Carolina" },
  { rank: 787, name: "MillerKnoll", domain: "millerknoll.com", revenueUsdBillions: 3.67, employees: 10380, vertical: "Manufacturing", hqCity: "Zeeland", hqState: "Michigan" },
  { rank: 794, name: "EnerSys", domain: "enersys.com", revenueUsdBillions: 3.62, employees: 10860, vertical: "Electrical Equipment", hqCity: "Reading", hqState: "Pennsylvania" },
  { rank: 795, name: "Trimble", domain: "trimble.com", revenueUsdBillions: 3.59, employees: 11500, vertical: "Industrial Technology", hqCity: "Westminster", hqState: "Colorado" },
  { rank: 799, name: "Woodward", domain: "woodward.com", revenueUsdBillions: 3.57, employees: 10200, vertical: "Aerospace & Defense", hqCity: "Fort Collins", hqState: "Colorado" },
  { rank: 800, name: "Advantage Solutions", domain: "advantagesolutions.net", revenueUsdBillions: 3.54, employees: 44500, vertical: "Commercial Services", hqCity: "St. Louis", hqState: "Missouri" },
  { rank: 801, name: "Extra Space Storage", domain: "extraspace.com", revenueUsdBillions: 3.54, employees: 8390, vertical: "Real Estate Services", hqCity: "Salt Lake City", hqState: "Utah" },
  { rank: 804, name: "Match Group", domain: "mtch.com", revenueUsdBillions: 3.49, employees: 2210, vertical: "Internet Services", hqCity: "Dallas", hqState: "Texas" },
  { rank: 810, name: "IDEX", domain: "idexcorp.com", revenueUsdBillions: 3.46, employees: 8700, vertical: "Machinery", hqCity: "Northbrook", hqState: "Illinois" },
  { rank: 812, name: "Bruker", domain: "bruker.com", revenueUsdBillions: 3.44, employees: 11090, vertical: "Scientific Instruments", hqCity: "Billerica", hqState: "Massachusetts" },
  { rank: 813, name: "Datadog", domain: "datadoghq.com", revenueUsdBillions: 3.43, employees: 8100, vertical: "Software", hqCity: "New York", hqState: "New York" },
  { rank: 827, name: "Acadia Healthcare", domain: "acadiahealthcare.com", revenueUsdBillions: 3.31, employees: 22000, vertical: "Healthcare Services", hqCity: "Franklin", hqState: "Tennessee" },
  { rank: 828, name: "Surgery Partners", domain: "surgerypartners.com", revenueUsdBillions: 3.31, employees: 16000, vertical: "Healthcare Services", hqCity: "Brentwood", hqState: "Tennessee" },
  { rank: 835, name: "CoStar Group", domain: "costargroup.com", revenueUsdBillions: 3.25, employees: 8440, vertical: "Real Estate Technology", hqCity: "Arlington", hqState: "Virginia" },
  { rank: 836, name: "Exact Sciences", domain: "exactsciences.com", revenueUsdBillions: 3.25, employees: 7150, vertical: "Medical Devices", hqCity: "Madison", hqState: "Wisconsin" },
  { rank: 837, name: "AdaptHealth", domain: "adapthealth.com", revenueUsdBillions: 3.24, employees: 10900, vertical: "Healthcare Services", hqCity: "Conshohocken", hqState: "Pennsylvania" },
  { rank: 839, name: "Saia", domain: "saia.com", revenueUsdBillions: 3.23, employees: 14120, vertical: "Ground Transportation", hqCity: "Johns Creek", hqState: "Georgia" },
  { rank: 840, name: "Affirm Holdings", domain: "affirm.com", revenueUsdBillions: 3.22, employees: 2210, vertical: "Financial Services", hqCity: "San Francisco", hqState: "California" },
  { rank: 842, name: "DocuSign", domain: "docusign.com", revenueUsdBillions: 3.22, employees: 7040, vertical: "Software", hqCity: "San Francisco", hqState: "California" },
  { rank: 849, name: "Veeva Systems", domain: "veeva.com", revenueUsdBillions: 3.20, employees: 7930, vertical: "Healthcare Software", hqCity: "Pleasanton", hqState: "California" },
  { rank: 850, name: "Brookdale Senior Living", domain: "brookdale.com", revenueUsdBillions: 3.19, employees: 27720, vertical: "Healthcare Services", hqCity: "Brentwood", hqState: "Tennessee" },
];

export function employeeRange(employees: number) {
  if (employees < 1000) return "Under 1,000";
  if (employees < 5000) return "1,000–5,000";
  if (employees < 10000) return "5,000–10,000";
  if (employees < 20000) return "10,000–20,000";
  if (employees < 50000) return "20,000–50,000";
  return "50,000+";
}

export function targetTitles(vertical: string) {
  if (/health|pharma|medical|life science/i.test(vertical)) {
    return ["Chief Operating Officer", "VP Operations", "Chief Digital Officer"];
  }
  if (/financial|bank|insurance|capital/i.test(vertical)) {
    return ["Chief Operating Officer", "VP Operations", "Chief Data Officer"];
  }
  if (/retail|consumer|restaurant|hospitality/i.test(vertical)) {
    return ["Chief Operating Officer", "VP Operations", "VP Customer Experience"];
  }
  if (/transport|logistics|airline|distribution/i.test(vertical)) {
    return ["Chief Operating Officer", "VP Operations", "VP Digital Transformation"];
  }
  if (/software|technology|internet|cloud/i.test(vertical)) {
    return ["Chief Operating Officer", "VP Business Operations", "Chief Data Officer"];
  }
  return ["Chief Operating Officer", "VP Operational Excellence", "Chief Data Officer"];
}

export function targetAccountRows() {
  return targetAccounts.map((account) => ({
    name: account.name,
    domain: account.domain,
    vertical: account.vertical,
    employee_range: employeeRange(account.employees),
    hq_city: account.hqCity,
    hq_state: account.hqState,
    target_titles: targetTitles(account.vertical),
    news_query: `"${account.name}" (AI OR automation OR operations OR data OR hiring)`,
    status: "active" as const,
  }));
}
