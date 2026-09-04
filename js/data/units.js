/* =============================================================================
   data/units.js — home multi-station units sold in South Africa

   A home "smith machine" is a whole small gym on one frame, and the generator
   needs to know which stations a given one actually has before it can say
   what you can train on it. Each entry lists the unit's stations from a fixed
   vocabulary; js/programs.js maps those onto equipment ids and onto the
   exercises each station can perform.

   `confidence` is honest about the source: `high` means a manufacturer or
   retailer spec sheet, `medium` a retailer listing, `low` stations read off
   product photos. Prices are approximate and in rand at the time of writing.

   Stations vocabulary:
     smith freeBarbell cable latPulldown lowRow pecDeck legDeveloper
     preacherCurl dipStation pullupBar bench legPress cableCrossover
   ============================================================================= */
(function (App) {
  'use strict';
  App.SeedUnits = [
    {
      "id": "trojan-tsm1000-multifunction-smith-machine",
      "brand": "Trojan",
      "name": "TSM1000 Multifunction Smith Machine",
      "retailers": [
        "Makro",
        "Game"
      ],
      "priceZar": 14999,
      "stations": [
        "smith",
        "cable",
        "latPulldown",
        "lowRow",
        "pecDeck",
        "legDeveloper",
        "preacherCurl",
        "bench"
      ],
      "maxLoadKg": 200,
      "confidence": "high",
      "notes": "This is 'the Trojan one at Makro'. Makro R13,499-R14,999 in catalogues 2022-2025; Game R13,999 (Aug 2024). Manual: max user 200 kg, max loading 200 kg, 2-year warranty. Includes butterfly (pec) arms, lat bar, foot plate + low pulley for rows, bench with 7 backrest positions, preacher-curl pad, curl bar, leg lever (extension/curl), ankle strap, barbell rests + spotters on the guided bar. Weight bar ships with Olympic (50 mm) plate adapters; plates and Olympic bar not included. No separate free-bar rack, no dip handles, no pull-up bar.",
      "source": "https://www.trojanhealth.co.za/storage/TROJAN-MULTI-FUNCTION-SMITH-MACHINE-MANUAL.pdf"
    },
    {
      "id": "trojan-pro-series-smith-machine-2",
      "brand": "Trojan",
      "name": "Pro Series Multifunction Smith Machine 2.0",
      "retailers": [
        "Makro",
        "Game",
        "Takealot"
      ],
      "priceZar": 48999,
      "stations": [
        "smith",
        "freeBarbell",
        "cable",
        "latPulldown",
        "lowRow",
        "pullupBar",
        "cableCrossover"
      ],
      "maxLoadKg": 200,
      "confidence": "high",
      "notes": "Trojan RRP R48,999 (bench and plates extra); seen at Makro for R43,999 and R45,999 bundled with the Pro Series incline bench. Manual: max user 200 kg, max loading 200 kg, 3-year warranty, set-up 2190 x 1800 x 2270 mm. Has a weight stack for the cable/lat pull, Olympic bar rests (free-bar squat rack), pull-up handle, plate hanger rack; listed top exercises include crossover, chest fly, rotational row, lat pull, smith row, bench leg press, chest press with bar. Bench sold separately.",
      "source": "https://www.trojanhealth.co.za/storage/TROJAN-PRO-SERIES-MULTIFUNCTION-SMITH-MACHINE-2.0-MANUAL.pdf"
    },
    {
      "id": "trojan-power-gym-2",
      "brand": "Trojan",
      "name": "Power Gym 2.0 Home Gym",
      "retailers": [
        "Makro",
        "Game"
      ],
      "priceZar": 6999,
      "stations": [
        "cable",
        "latPulldown",
        "pecDeck",
        "legDeveloper"
      ],
      "maxLoadKg": 60,
      "confidence": "high",
      "notes": "Makro lists it now as 'Trojan 62.4 kg Power 2.0 Home Gym Combo' at R6,999 (catalogue lows of R5,999). Manual: max user 130 kg, max loading 60 kg, plate-loaded (plates included in the combo). Exercise functions: seated pec deck, seated chest press, seated leg extensions, standing hamstring curls, lat pull downs, straight-arm pull backs, triceps push downs. Not a smith machine; chest-press arm is not in the station vocabulary.",
      "source": "https://www.trojanhealth.co.za/storage/22M01T001.3-Trojan-Power-Gym-2.0-Home-Gym-User-Manual.pdf"
    },
    {
      "id": "trojan-elite-gym-2",
      "brand": "Trojan",
      "name": "Elite Gym 2.0 Home Gym",
      "retailers": [
        "Makro",
        "Game"
      ],
      "priceZar": 9999,
      "stations": [
        "cable",
        "latPulldown",
        "lowRow",
        "pecDeck",
        "legDeveloper",
        "preacherCurl"
      ],
      "maxLoadKg": 90,
      "confidence": "high",
      "notes": "Makro catalogue R7,999-R9,999 (2023-2026). Manual: selectorised 90 kg stack, max user 120 kg, set-up 2030 x 1160 x 1850 mm. Parts list includes lat bar, low row bar, left/right pec arms, press arm, leg extension arm, arm-curl (preacher) pad and handle, abdominal handle, adjustable backrest seat. Not a smith machine.",
      "source": "https://www.trojanhealth.co.za/storage/ELITE-GYM-2.0-HOME-GYM-MANUAL-REV-1.pdf"
    },
    {
      "id": "trojan-power-tower-200",
      "brand": "Trojan",
      "name": "Power Tower 200",
      "retailers": [
        "Makro",
        "Game"
      ],
      "priceZar": 2999,
      "stations": [
        "pullupBar",
        "dipStation"
      ],
      "maxLoadKg": null,
      "confidence": "high",
      "notes": "Makro 'Trojan 4 kg Power Tower 200 Home Gym Combo' R2,999 (seen live on makro.co.za, Sep 2026). Bodyweight station: pull-ups/chin-ups, dips, vertical knee raises, push-up handles. Max user 135 kg.",
      "source": "https://www.makro.co.za/trojan-4-kg-power-tower-200-home-gym-combo/p/itm89d9e807c9920"
    },
    {
      "id": "gorilla-sports-multifunction-smith-machine",
      "brand": "Gorilla Sports",
      "name": "Multifunction Smith Machine",
      "retailers": [
        "Makro",
        "Gorilla Sports SA (gorillasports.co.za)",
        "Markvet Group"
      ],
      "priceZar": 37499,
      "stations": [
        "smith",
        "freeBarbell",
        "cable",
        "latPulldown",
        "lowRow",
        "pullupBar"
      ],
      "maxLoadKg": 200,
      "confidence": "medium",
      "notes": "Gorilla Sports SA sale price R37,499 (was R49,999); Markvet R37,000 (out of stock at time of research); Makro lists it as 'Gorilla Sports Multifunction Smith Machine Home Gym Combo'. Spec: 219 x 127.5 x 218.5 cm, 195 kg, guided bar for 50/51 mm plates, barbell max 200 kg, pull-up frame max 150 kg, each plate holder max 100 kg. Includes triceps rope, single-hand cable handles, biceps/triceps bar, pull-up bar with multiple grips, 14 spring locks. gorillasports.co.za now redirects to the EU store, so SA availability may be via Makro only. Free-bar rack and low-row inferred from photos/EU listing, not an SA spec sheet.",
      "source": "https://markvetgroup.co.za/product/multifunction-smith-machine/"
    },
    {
      "id": "jaguar-fitness-smith-machine-with-cable-system",
      "brand": "Jaguar Fitness",
      "name": "Smith Machine with Cable System",
      "retailers": [
        "Jaguar Fitness (jaguarfitness.co.za)"
      ],
      "priceZar": 19130,
      "stations": [
        "smith",
        "freeBarbell",
        "cable",
        "latPulldown",
        "lowRow",
        "dipStation",
        "pullupBar"
      ],
      "maxLoadKg": 240,
      "confidence": "high",
      "notes": "R19,129.56. Smith 240 kg, cable 200 kg (100 kg effective), free rack 150 kg. Olympic 50 mm plates, 25 mm with adapters removed. Includes dip handles, landmine, pull-up bar; lat pulldown, seated row, face pull, cable curl, pushdown. Plates, bench and Olympic bar not included.",
      "source": "https://www.jaguarfitness.co.za/products/multifunction-smith-machine"
    },
    {
      "id": "marcy-smith-cage-sm-4008",
      "brand": "Marcy",
      "name": "Smith Cage Home Gym",
      "retailers": [
        "Sportsmans Warehouse"
      ],
      "priceZar": 29999,
      "stations": [
        "smith",
        "freeBarbell",
        "cable",
        "latPulldown",
        "lowRow",
        "pecDeck",
        "legDeveloper",
        "bench",
        "pullupBar",
        "cableCrossover"
      ],
      "maxLoadKg": 136,
      "confidence": "high",
      "notes": "Sportsmans Warehouse R29,999.90 (PLU 1172223). Marcy spec: 300 lb (136 kg) on the smith bar and max user, 200 lb on crossover/lat pull, 100 lb on leg developer; bar catches and safety catches for an Olympic bar (sold separately); independent upper pulleys for crossovers that also drive the pec deck; low pulley for rows; adjustable utility bench with leg developer; pull-up bar. Takes standard or Olympic plates (adapter sleeves). No preacher curl, no dip.",
      "source": "https://www.sportsmanswarehouse.co.za/product/marcy-smith-cage/"
    },
    {
      "id": "force-usa-g3-all-in-one-trainer",
      "brand": "Force USA",
      "name": "G3 All-In-One Trainer",
      "retailers": [
        "Fitness Network (fitnessnetwork.co.za)",
        "Sportsmans Warehouse"
      ],
      "priceZar": 34999,
      "stations": [
        "smith",
        "freeBarbell",
        "cable",
        "cableCrossover",
        "latPulldown",
        "lowRow",
        "pullupBar"
      ],
      "maxLoadKg": 325,
      "confidence": "high",
      "notes": "Smith 325 kg, power rack J-hooks 425 kg, functional-trainer shuttles 200 kg (2:1 ratio), chin-up bar 450 kg. Plate-loaded, Olympic. Lat pulldown/low-row seat, leg press plate, dip handles and jammer arms are optional add-ons, so latPulldown/lowRow are done standing or with the optional seat.",
      "source": "https://www.fitnessnetwork.co.za/force-usa-g3-all-in-one-trainer"
    },
    {
      "id": "force-fitness-g2-all-in-one-trainer",
      "brand": "Force Fitness",
      "name": "G2 All-In-One Trainer",
      "retailers": [
        "Gym Gear (gymgear.co.za)"
      ],
      "priceZar": 38995,
      "stations": [
        "smith",
        "freeBarbell",
        "cable",
        "cableCrossover",
        "latPulldown",
        "lowRow",
        "pullupBar",
        "dipStation"
      ],
      "maxLoadKg": 450,
      "confidence": "high",
      "notes": "Smith bar 450 kg, 14 catch positions; dual cable crossover with 16 height positions; free-weight squat rack with J-hooks and safety arms; multi-grip pull-up bar; adjustable dip station; T-bar/landmine; lat pulldown knee pad included. Standard and Olympic plates.",
      "source": "https://gymgear.co.za/products/force-fitness-g2-all-in-one-trainer"
    },
    {
      "id": "tunturi-sm80-all-in-one-smith-machine",
      "brand": "Tunturi",
      "name": "SM80 All-in-One Smith Machine",
      "retailers": [
        "Gym Gear (gymgear.co.za)"
      ],
      "priceZar": 38850,
      "stations": [
        "smith",
        "freeBarbell",
        "cable",
        "latPulldown",
        "lowRow",
        "pecDeck",
        "pullupBar"
      ],
      "maxLoadKg": null,
      "confidence": "medium",
      "notes": "Smith press, high pulley with curved lat bar, low pulley with straight bar, pec-dec station, chin-up bar, barbell supports for free-weight work, plate storage. 30 mm and 50 mm plates, Olympic bar compatible; 7 kg smith bar. Max load not published on the SA listing.",
      "source": "https://gymgear.co.za/products/tunturi-sm80-all-in-one-smith-machine"
    },
    {
      "id": "skelcore-2-in-1-smith-machine-squat-rack",
      "brand": "Skelcore",
      "name": "2 in 1 Smith Machine & Squat Rack Combo",
      "retailers": [
        "Skelcore SA (skelcore.co.za)"
      ],
      "priceZar": 34990,
      "stations": [
        "smith",
        "freeBarbell",
        "pullupBar"
      ],
      "maxLoadKg": 175,
      "confidence": "high",
      "notes": "R34,990 on the smith-machines collection page (a heavier variant is R51,740). J-hooks 350 kg, pull-up bar 250 kg, max user 300 kg, max load per exercise 175 kg, 16 height levels. No cables.",
      "source": "https://skelcore.co.za/collections/smith-machines"
    },
    {
      "id": "powercore-stealth-functional-smith-trainer",
      "brand": "Powercore",
      "name": "Stealth Functional Smith Trainer",
      "retailers": [
        "MiFitness (mifitness.co.za)"
      ],
      "priceZar": 45990,
      "stations": [
        "smith",
        "freeBarbell",
        "cable",
        "cableCrossover",
        "latPulldown",
        "lowRow",
        "pullupBar"
      ],
      "maxLoadKg": null,
      "confidence": "medium",
      "notes": "R45,990 (was R49,990). Olympic smith bar, 2 x 80 kg weight stacks driving hi/low pulleys, safety arms, landmine, pull-up bar, 6 plate storage rods; 75 x 75 x 3 mm frame. Free-bar rack inferred from the included safety arms and the 60 mm hole spacing.",
      "source": "https://mifitness.co.za/collections/smith-machine/products/powercore-stealth-functional-powercore-trainer-without-rack"
    },
    {
      "id": "everlast-elite-home-gym",
      "brand": "Everlast",
      "name": "Elite Home Gym",
      "retailers": [
        "iloveza.com",
        "Makro (historically)"
      ],
      "priceZar": 6999,
      "stations": [
        "cable",
        "latPulldown",
        "lowRow",
        "pecDeck",
        "legDeveloper",
        "preacherCurl"
      ],
      "maxLoadKg": 60,
      "confidence": "medium",
      "notes": "R6,999 at iloveza.com; Makro sold it at R6,499. Manual (ManualsLib): 5-60 kg selectorised stack, max user 130 kg, 35 exercises incl. wide-grip lat pulldown, seated low row, rear-delt/pec fly arms, seated leg extension, standing hamstring curl, preacher curls, seated triceps press. everlastsa.co.za was 'store unavailable' during research, so current SA stock is uncertain. Not a smith machine.",
      "source": "https://www.iloveza.com/products/everlast-elite-home-gym"
    }
  ];
})(window.App = window.App || {});
