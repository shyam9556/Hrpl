// Solar kit configurations from Raysolar Energy PDF Price List
// These wholesale dealer price kits can be updated here without modifying the quotation component
const PDF_KITS = [
  // Sunora Bifacial 545-550
  { id: "sb_218", brand: "Sunora", type: "Bifacial", watt: 545, panels: 4, kw: 2.18, price: 93508, invBrand: "Xwatt/REM/Vsole", invKw: 3.6 },
  { id: "sb_272", brand: "Sunora", type: "Bifacial", watt: 545, panels: 5, kw: 2.72, price: 109687, invBrand: "Xwatt/REM/Vsole", invKw: 3.6 },
  { id: "sb_327", brand: "Sunora", type: "Bifacial", watt: 545, panels: 6, kw: 3.27, price: 123381, invBrand: "Xwatt/REM/Vsole", invKw: 3.6 },
  { id: "sb_381", brand: "Sunora", type: "Bifacial", watt: 545, panels: 7, kw: 3.81, price: 139075, invBrand: "Xwatt/REM/Vsole", invKw: 3.6 },
  { id: "sb_436", brand: "Sunora", type: "Bifacial", watt: 545, panels: 8, kw: 4.36, price: 163254, invBrand: "Xwatt/REM/Vsole", invKw: 4.0 },
  { id: "sb_490", brand: "Sunora", type: "Bifacial", watt: 545, panels: 9, kw: 4.90, price: 183563, invBrand: "Xwatt/REM/Vsole", invKw: 5.0 },
  { id: "sb_545", brand: "Sunora", type: "Bifacial", watt: 545, panels: 10, kw: 5.45, price: 199067, invBrand: "Xwatt/REM/Vsole", invKw: 5.0 },
  { id: "sb_599", brand: "Sunora", type: "Bifacial", watt: 545, panels: 11, kw: 5.99, price: 220371, invBrand: "Xwatt/REM/Vsole", invKw: 5.0 },
  { id: "sb_708", brand: "Sunora", type: "Bifacial", watt: 545, panels: 14, kw: 7.08, price: 282190, invBrand: "Xwatt/REM/Vsole", invKw: 10.0 },
  { id: "sb_817", brand: "Sunora", type: "Bifacial", watt: 545, panels: 15, kw: 8.17, price: 299707, invBrand: "Xwatt/REM/Vsole", invKw: 10.0 },
  { id: "sb_990", brand: "Sunora", type: "Bifacial", watt: 545, panels: 18, kw: 9.90, price: 345919, invBrand: "Xwatt/REM/Vsole", invKw: 10.0 },

  // Sunora TOPCon 580-600
  { id: "st_240", brand: "Sunora", type: "TOPCon", watt: 580, panels: 4, kw: 2.40, price: 101230, invBrand: "Xwatt/REM/Vsole", invKw: 3.6 },
  { id: "st_300", brand: "Sunora", type: "TOPCon", watt: 580, panels: 5, kw: 3.00, price: 119340, invBrand: "Xwatt/REM/Vsole", invKw: 3.6 },
  { id: "st_360", brand: "Sunora", type: "TOPCon", watt: 580, panels: 6, kw: 3.60, price: 134844, invBrand: "Xwatt/REM/Vsole", invKw: 3.6 },
  { id: "st_420", brand: "Sunora", type: "TOPCon", watt: 580, panels: 7, kw: 4.20, price: 152589, invBrand: "Xwatt/REM/Vsole", invKw: 5.0 },
  { id: "st_480", brand: "Sunora", type: "TOPCon", watt: 580, panels: 8, kw: 4.80, price: 178698, invBrand: "Xwatt/REM/Vsole", invKw: 5.0 },
  { id: "st_540", brand: "Sunora", type: "TOPCon", watt: 580, panels: 9, kw: 5.40, price: 200803, invBrand: "Xwatt/REM/Vsole", invKw: 5.0 },
  { id: "st_600", brand: "Sunora", type: "TOPCon", watt: 580, panels: 10, kw: 6.00, price: 218223, invBrand: "Xwatt/REM/Vsole", invKw: 5.0 },
  { id: "st_660", brand: "Sunora", type: "TOPCon", watt: 580, panels: 11, kw: 6.60, price: 241332, invBrand: "Xwatt/REM/Vsole", invKw: 10.0 },
  { id: "st_720", brand: "Sunora", type: "TOPCon", watt: 580, panels: 12, kw: 7.20, price: 279527, invBrand: "Xwatt/REM/Vsole", invKw: 10.0 },
  { id: "st_840", brand: "Sunora", type: "TOPCon", watt: 580, panels: 14, kw: 8.40, price: 312000, invBrand: "Xwatt/REM/Vsole", invKw: 10.0 },
  { id: "st_960", brand: "Sunora", type: "TOPCon", watt: 580, panels: 16, kw: 9.60, price: 347758, invBrand: "Xwatt/REM/Vsole", invKw: 10.0 },

  // Adani Bifacial 540-555
  { id: "ab_220", brand: "Adani Solar", type: "Bifacial", watt: 540, panels: 4, kw: 2.20, price: 102748, invBrand: "Xwatt/REM/Vsole", invKw: 3.6 },
  { id: "ab_275", brand: "Adani Solar", type: "Bifacial", watt: 540, panels: 5, kw: 2.75, price: 121237, invBrand: "Xwatt/REM/Vsole", invKw: 3.6 },
  { id: "ab_330", brand: "Adani Solar", type: "Bifacial", watt: 540, panels: 6, kw: 3.30, price: 134601, invBrand: "Xwatt/REM/Vsole", invKw: 3.6 },
  { id: "ab_385", brand: "Adani Solar", type: "Bifacial", watt: 540, panels: 7, kw: 3.85, price: 155245, invBrand: "Xwatt/REM/Vsole", invKw: 3.6 },
  { id: "ab_440", brand: "Adani Solar", type: "Bifacial", watt: 540, panels: 8, kw: 4.40, price: 181734, invBrand: "Xwatt/REM/Vsole", invKw: 5.0 },
  { id: "ab_495", brand: "Adani Solar", type: "Bifacial", watt: 540, panels: 9, kw: 4.95, price: 204353, invBrand: "Xwatt/REM/Vsole", invKw: 5.0 },
  { id: "ab_550", brand: "Adani Solar", type: "Bifacial", watt: 540, panels: 10, kw: 5.50, price: 222167, invBrand: "Xwatt/REM/Vsole", invKw: 5.0 },
  { id: "ab_605", brand: "Adani Solar", type: "Bifacial", watt: 540, panels: 11, kw: 6.05, price: 245781, invBrand: "Xwatt/REM/Vsole", invKw: 10.0 },
  { id: "ab_660", brand: "Adani Solar", type: "Bifacial", watt: 540, panels: 12, kw: 6.60, price: 314530, invBrand: "Xwatt/REM/Vsole", invKw: 10.0 },
  { id: "ab_825", brand: "Adani Solar", type: "Bifacial", watt: 540, panels: 15, kw: 8.25, price: 334357, invBrand: "Xwatt/REM/Vsole", invKw: 10.0 },
  { id: "ab_990", brand: "Adani Solar", type: "Bifacial", watt: 540, panels: 18, kw: 9.90, price: 387499, invBrand: "Xwatt/REM/Vsole", invKw: 10.0 },

  // Adani TOPCon 605-620
  { id: "at_248", brand: "Adani Solar", type: "TOPCon", watt: 605, panels: 4, kw: 2.48, price: 112736, invBrand: "Xwatt/REM/Vsole", invKw: 3.6 },
  { id: "at_310", brand: "Adani Solar", type: "TOPCon", watt: 605, panels: 5, kw: 3.10, price: 133722, invBrand: "Xwatt/REM/Vsole", invKw: 3.6 },
  { id: "at_372", brand: "Adani Solar", type: "TOPCon", watt: 605, panels: 6, kw: 3.72, price: 152055, invBrand: "Xwatt/REM/Vsole", invKw: 3.6 },
  { id: "at_434", brand: "Adani Solar", type: "TOPCon", watt: 605, panels: 7, kw: 4.34, price: 172724, invBrand: "Xwatt/REM/Vsole", invKw: 5.0 },
  { id: "at_496", brand: "Adani Solar", type: "TOPCon", watt: 605, panels: 8, kw: 4.96, price: 201710, invBrand: "Xwatt/REM/Vsole", invKw: 5.0 },
  { id: "at_558", brand: "Adani Solar", type: "TOPCon", watt: 605, panels: 9, kw: 5.58, price: 226637, invBrand: "Xwatt/REM/Vsole", invKw: 5.0 },
  { id: "at_620", brand: "Adani Solar", type: "TOPCon", watt: 605, panels: 10, kw: 6.20, price: 246927, invBrand: "Xwatt/REM/Vsole", invKw: 10.0 },
  { id: "at_682", brand: "Adani Solar", type: "TOPCon", watt: 605, panels: 11, kw: 6.82, price: 272863, invBrand: "Xwatt/REM/Vsole", invKw: 10.0 },
  { id: "at_744", brand: "Adani Solar", type: "TOPCon", watt: 605, panels: 12, kw: 7.44, price: 313876, invBrand: "Xwatt/REM/Vsole", invKw: 10.0 },
  { id: "at_806", brand: "Adani Solar", type: "TOPCon", watt: 605, panels: 13, kw: 8.06, price: 350338, invBrand: "Xwatt/REM/Vsole", invKw: 10.0 },
  { id: "at_992", brand: "Adani Solar", type: "TOPCon", watt: 605, panels: 16, kw: 9.92, price: 393557, invBrand: "Xwatt/REM/Vsole", invKw: 10.0 },

  // Waaree Mono PERC 535-540
  { id: "wm_216", brand: "Waaree", type: "Mono PERC", watt: 535, panels: 4, kw: 2.16, price: 96980, invBrand: "Xwatt/REM/Vsole", invKw: 3.6 },
  { id: "wm_270", brand: "Waaree", type: "Mono PERC", watt: 535, panels: 5, kw: 2.70, price: 114027, invBrand: "Xwatt/REM/Vsole", invKw: 3.6 },
  { id: "wm_324", brand: "Waaree", type: "Mono PERC", watt: 535, panels: 6, kw: 3.24, price: 128613, invBrand: "Xwatt/REM/Vsole", invKw: 3.6 },
  { id: "wm_378", brand: "Waaree", type: "Mono PERC", watt: 535, panels: 7, kw: 3.78, price: 145151, invBrand: "Xwatt/REM/Vsole", invKw: 3.6 },
  { id: "wm_432", brand: "Waaree", type: "Mono PERC", watt: 535, panels: 8, kw: 4.32, price: 170198, invBrand: "Xwatt/REM/Vsole", invKw: 5.0 },
  { id: "wm_486", brand: "Waaree", type: "Mono PERC", watt: 535, panels: 9, kw: 4.86, price: 191402, invBrand: "Xwatt/REM/Vsole", invKw: 5.0 },
  { id: "wm_540", brand: "Waaree", type: "Mono PERC", watt: 535, panels: 10, kw: 5.40, price: 207777, invBrand: "Xwatt/REM/Vsole", invKw: 5.0 },
  { id: "wm_594", brand: "Waaree", type: "Mono PERC", watt: 535, panels: 11, kw: 5.94, price: 229974, invBrand: "Xwatt/REM/Vsole", invKw: 5.0 },
  { id: "wm_756", brand: "Waaree", type: "Mono PERC", watt: 535, panels: 14, kw: 7.56, price: 297520, invBrand: "Xwatt/REM/Vsole", invKw: 10.0 },
  { id: "wm_810", brand: "Waaree", type: "Mono PERC", watt: 535, panels: 15, kw: 8.10, price: 311320, invBrand: "Xwatt/REM/Vsole", invKw: 10.0 },
  { id: "wm_972", brand: "Waaree", type: "Mono PERC", watt: 535, panels: 18, kw: 9.72, price: 357133, invBrand: "Xwatt/REM/Vsole", invKw: 10.0 },

  // Waaree TOPCon 570-580
  { id: "wt_232", brand: "Waaree", type: "TOPCon", watt: 570, panels: 4, kw: 2.32, price: 105284, invBrand: "Xwatt/REM/Vsole", invKw: 3.6 },
  { id: "wt_290", brand: "Waaree", type: "TOPCon", watt: 570, panels: 5, kw: 2.90, price: 124407, invBrand: "Xwatt/REM/Vsole", invKw: 3.6 },
  { id: "wt_348", brand: "Waaree", type: "TOPCon", watt: 570, panels: 6, kw: 3.48, price: 140973, invBrand: "Xwatt/REM/Vsole", invKw: 3.6 },
  { id: "wt_406", brand: "Waaree", type: "TOPCon", watt: 570, panels: 7, kw: 4.06, price: 158059, invBrand: "Xwatt/REM/Vsole", invKw: 5.0 },
  { id: "wt_464", brand: "Waaree", type: "TOPCon", watt: 570, panels: 8, kw: 4.64, price: 186806, invBrand: "Xwatt/REM/Vsole", invKw: 5.0 },
  { id: "wt_522", brand: "Waaree", type: "TOPCon", watt: 570, panels: 9, kw: 5.22, price: 209978, invBrand: "Xwatt/REM/Vsole", invKw: 5.0 },
  { id: "wt_580", brand: "Waaree", type: "TOPCon", watt: 570, panels: 10, kw: 5.80, price: 228417, invBrand: "Xwatt/REM/Vsole", invKw: 5.0 },
  { id: "wt_638", brand: "Waaree", type: "TOPCon", watt: 570, panels: 11, kw: 6.38, price: 252590, invBrand: "Xwatt/REM/Vsole", invKw: 10.0 },
  { id: "wt_696", brand: "Waaree", type: "TOPCon", watt: 570, panels: 12, kw: 6.96, price: 291856, invBrand: "Xwatt/REM/Vsole", invKw: 10.0 },
  { id: "wt_812", brand: "Waaree", type: "TOPCon", watt: 570, panels: 14, kw: 8.12, price: 326384, invBrand: "Xwatt/REM/Vsole", invKw: 10.0 },
  { id: "wt_986", brand: "Waaree", type: "TOPCon", watt: 570, panels: 17, kw: 9.86, price: 381365, invBrand: "Xwatt/REM/Vsole", invKw: 10.0 },
];

export default PDF_KITS;
