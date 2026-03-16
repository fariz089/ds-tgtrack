// seedCarCentroVehicles.js
// Seeds all vehicles from CarCentro (AoooG) GPS tracking platform
// Data extracted from TrackData API and GetDeviceGroupData API
// Groups: AKAP (22 buses), PARIWISATA (17 buses), OPERASIONAL (1 vehicle)

require("dotenv").config();
const mongoose = require("mongoose");
const Vehicle = require("./models/vehicle");

// ============================================================
// All CarCentro vehicles from JURAGAN 99 TRANS
// Extracted from carcentro.aooog.com API responses
// ============================================================

const carCentroVehicles = [
  // ======== AKAP GROUP (Antar Kota Antar Provinsi) ========
  {
    name: "PHANTOM",
    display_name: "N 7703 UE-PHANTOM",
    lpn: "N 7703 UE",
    imei: "800001",
    fleet_name: "JURAGAN99-AKAP",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "KOBOCHAN",
    display_name: "N 7049 UF-KOBOCHAN",
    lpn: "N 7049 UF",
    imei: "800003",
    fleet_name: "JURAGAN99-AKAP",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "GUNDAM",
    display_name: "N 7395 UH-GUNDAM",
    lpn: "N 7395 UH",
    imei: "800005",
    fleet_name: "JURAGAN99-AKAP",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "SIMPSON",
    display_name: "N 7707 UE-SIMPSON",
    lpn: "N 7707 UE",
    imei: "350544501576519",
    fleet_name: "JURAGAN99-AKAP",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "TAKESHI",
    display_name: "N 7201 UG-TAKESHI",
    lpn: "N 7201 UG",
    imei: "232211740001",
    fleet_name: "JURAGAN99-AKAP",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "TAKUMI",
    display_name: "N 7202 UG-TAKUMI",
    lpn: "N 7202 UG",
    imei: "232211740002",
    fleet_name: "JURAGAN99-AKAP",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "TWEETY",
    display_name: "N 7187 UG-TWEETY",
    lpn: "N 7187 UG",
    imei: "023491174004",
    fleet_name: "JURAGAN99-AKAP",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "CASPER",
    display_name: "N 7280 UG-CASPER",
    lpn: "N 7280 UG",
    imei: "023491174005",
    fleet_name: "JURAGAN99-AKAP",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "GARFIELD",
    display_name: "N 7281 UG-GARFIELD",
    lpn: "N 7281 UG",
    imei: "023491174002",
    fleet_name: "JURAGAN99-AKAP",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "GOOFY",
    display_name: "N 7208 UG-GOOFY",
    lpn: "N 7208 UG",
    imei: "023491174003",
    fleet_name: "JURAGAN99-AKAP",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "SNOOPY",
    display_name: "N 7803 UG-SNOOPY",
    lpn: "N 7803 UG",
    imei: "242035204001",
    fleet_name: "JURAGAN99-AKAP",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "SHINCHAN",
    display_name: "N 7896 UG-SHINCHAN",
    lpn: "N 7896 UG",
    imei: "242035204002",
    fleet_name: "JURAGAN99-AKAP",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "FLINTSTONE",
    display_name: "N 7308 UG-FLINTSTONE",
    lpn: "N 7308 UG",
    imei: "242535204003",
    fleet_name: "JURAGAN99-AKAP",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "WOODY",
    display_name: "N 7804 UG-WOODY",
    lpn: "N 7804 UG",
    imei: "242535204001",
    fleet_name: "JURAGAN99-AKAP",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "SCOOBYDOO",
    display_name: "N 7326 UG-SCOOBYDOO",
    lpn: "N 7326 UG",
    imei: "242535204002",
    fleet_name: "JURAGAN99-AKAP",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "ALADDIN",
    display_name: "N 7888 UG-ALADDIN",
    lpn: "N 7888 UG",
    imei: "242535204004",
    fleet_name: "JURAGAN99-AKAP",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "JOKER",
    display_name: "JOKER",
    lpn: "JOKER",
    imei: "253035211201",
    fleet_name: "JURAGAN99-AKAP",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "HARLEY QUINN",
    display_name: "HARLEY QUINN",
    lpn: "HARLEY QUINN",
    imei: "253035211202",
    fleet_name: "JURAGAN99-AKAP",
    vehicle_type: "Bus",
    status: "active",
  },

  // ======== PARIWISATA GROUP (Tourism) ========
  {
    name: "SPARTAN",
    display_name: "N 7462 UH-SPARTAN",
    lpn: "N 7462 UH",
    imei: "350544508557439",
    fleet_name: "JURAGAN99-PARIWISATA",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "IMMORTAL",
    display_name: "N 7463 UH-IMMORTAL",
    lpn: "N 7463 UH",
    imei: "350544508054171",
    fleet_name: "JURAGAN99-PARIWISATA",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "ASTERIX",
    display_name: "N 7166 UF-ASTERIX",
    lpn: "N 7166 UF",
    imei: "350544501576303",
    fleet_name: "JURAGAN99-PARIWISATA",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "ELEANOR",
    display_name: "N 7048 UF-ELEANOR",
    lpn: "N 7048 UF",
    imei: "350544509828078",
    fleet_name: "JURAGAN99-PARIWISATA",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "OBELIX",
    display_name: "N 7167 UF-OBELIX",
    lpn: "N 7167 UF",
    imei: "357073296216241",
    fleet_name: "JURAGAN99-PARIWISATA",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "ROAD RUNNER",
    display_name: "N 7073 UF-ROAD RUNNER",
    lpn: "N 7073 UF",
    imei: "357073296216027",
    fleet_name: "JURAGAN99-PARIWISATA",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "MC-QUEEN",
    display_name: "N 7965 UG-MC-QUEEN",
    lpn: "N 7965 UG",
    imei: "357073292670961",
    fleet_name: "JURAGAN99-PARIWISATA",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "FRIGG",
    display_name: "N 7903 UG-FRIGG",
    lpn: "N 7903 UG",
    imei: "357073291705677",
    fleet_name: "JURAGAN99-PARIWISATA",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "CONCORDE",
    display_name: "N 7695 UG-CONCORDE",
    lpn: "N 7695 UG",
    imei: "350544508249151",
    fleet_name: "JURAGAN99-PARIWISATA",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "PEGASUS",
    display_name: "N 7709 GG-PEGASUS",
    lpn: "N 7709 GG",
    imei: "015770035946",
    fleet_name: "JURAGAN99-PARIWISATA",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "ROBIN HOOD",
    display_name: "N 9990 GG-ROBIN HOOD",
    lpn: "N 9990 GG",
    imei: "015770035947",
    fleet_name: "JURAGAN99-PARIWISATA",
    vehicle_type: "Bus",
    status: "active",
  },
  {
    name: "HERCULES",
    display_name: "N 7779 GG-HERCULES",
    lpn: "N 7779 GG",
    imei: "015770035948",
    fleet_name: "JURAGAN99-PARIWISATA",
    vehicle_type: "Bus",
    status: "active",
  },
  // NOTE: Some PARIWISATA buses may not be listed here because the API
  // response was truncated. The CarCentroWorker auto-registers any new
  // vehicles it discovers on its first fetch cycle, so missing buses
  // will be added automatically when the worker starts.

  // ======== OPERASIONAL GROUP ========
  {
    name: "TOWING",
    display_name: "N 9579 EB - TOWING",
    lpn: "N 9579 EB",
    imei: "357073296192806",
    fleet_name: "JURAGAN99-OPERASIONAL",
    vehicle_type: "Towing truck",
    status: "active",
  },
];

async function seedCarCentroVehicles() {
  try {
    const mongoUri =
      process.env.MONGO_URI ||
      "mongodb://root:example@mongo:27017/alertsDB?authSource=admin";

    console.log("Connecting to MongoDB...");
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✓ Connected to MongoDB\n");

    const existingCount = await Vehicle.countDocuments();
    console.log(`ℹ Database currently has ${existingCount} vehicles\n`);

    console.log("Seeding CarCentro vehicles (upsert by IMEI)...\n");
    let upserted = 0;
    let updated = 0;
    let errors = 0;

    for (const v of carCentroVehicles) {
      try {
        const result = await Vehicle.findOneAndUpdate(
          { imei: v.imei },
          { $set: v },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        if (
          result.createdAt &&
          new Date() - result.createdAt < 5000
        ) {
          upserted++;
          console.log(`  🆕 NEW: ${v.display_name} (${v.imei})`);
        } else {
          updated++;
        }
      } catch (err) {
        errors++;
        console.error(`  ❌ Error: ${v.display_name}: ${err.message}`);
      }
    }

    console.log(`\n✓ CarCentro seed completed:`);
    console.log(`  - New vehicles: ${upserted}`);
    console.log(`  - Updated: ${updated}`);
    console.log(`  - Errors: ${errors}`);

    // Print summary by group
    const allVehicles = await Vehicle.find({}).sort({ fleet_name: 1, name: 1 });
    console.log(`\n📋 All vehicles in database (${allVehicles.length}):\n`);

    let currentGroup = "";
    allVehicles.forEach((v, i) => {
      const group = v.fleet_name || "UNKNOWN";
      if (group !== currentGroup) {
        currentGroup = group;
        console.log(`\n  === ${group} ===`);
      }
      console.log(
        `  ${i + 1}. ${(v.display_name || v.name).padEnd(35)} IMEI: ${v.imei}`
      );
    });

    mongoose.connection.close();
    console.log("\n✓ Database connection closed");
    process.exit(0);
  } catch (err) {
    console.error("✗ Error seeding CarCentro vehicles:", err);
    mongoose.connection.close();
    process.exit(1);
  }
}

seedCarCentroVehicles();
