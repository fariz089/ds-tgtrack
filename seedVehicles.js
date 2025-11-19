require("dotenv").config();
const mongoose = require("mongoose");
const Vehicle = require("./models/vehicle");

const vehiclesData = [
  {
    name: "Tom",
    display_name: "TOM ( N 7002 UF )",
    lpn: "N 7002 UF",
    imei: "18270192347",
    fleet_name: "JURAGAN99",
    vehicle_type: "Passenger car",
    install_date: new Date("2025-04-02"),
    status: "active",
  },
  {
    name: "Jerry",
    display_name: "JERRY ( N 7004 UF  )",
    lpn: "N 7004 UF",
    imei: "18270191979",
    fleet_name: "JURAGAN99",
    vehicle_type: "Passenger car",
    install_date: new Date("2025-04-02"),
    status: "active",
  },
  {
    name: "Dumbo",
    display_name: "DUMBO ( N 7011 UF )",
    lpn: "N 7011 UF",
    imei: "18270192341",
    fleet_name: "JURAGAN99",
    vehicle_type: "Passenger car",
    install_date: new Date("2025-04-02"),
    status: "active",
  },
  {
    name: "Sonic",
    display_name: "SONIC ( N 7015 UF )",
    lpn: "N 7015 UF",
    imei: "18270191813",
    fleet_name: "JURAGAN99",
    vehicle_type: "Passenger car",
    install_date: new Date("2025-04-02"),
    status: "active",
  },
  {
    name: "Olive",
    display_name: "OLIVE ( N 7022 UG )",
    lpn: "N 7022 UG",
    imei: "18270191842",
    fleet_name: "JURAGAN99",
    vehicle_type: "Passenger car",
    install_date: new Date("2025-04-02"),
    status: "active",
  },
  {
    name: "Popeye",
    display_name: "POPEYE ( N 7397 UG )",
    lpn: "N 7397 UG",
    imei: "18270192168",
    fleet_name: "JURAGAN99",
    vehicle_type: "Passenger car",
    install_date: new Date("2025-04-02"),
    status: "active",
  },
  {
    name: "Dora",
    display_name: "DORA ( N 7430 UG )",
    lpn: "N 7430 UG",
    imei: "18270192151",
    fleet_name: "JURAGAN99",
    vehicle_type: "Passenger car",
    install_date: new Date("2025-04-02"),
    status: "active",
  },
  {
    name: "Hatori",
    display_name: "HATORI ( N 7431 UG )",
    lpn: "N 7431 UG",
    imei: "18270192289",
    fleet_name: "JURAGAN99",
    vehicle_type: "Passenger car",
    install_date: new Date("2025-04-02"),
    status: "active",
  },
  {
    name: "Patrick",
    display_name: "PATRICK ( N 7433 UG )",
    lpn: "N 7433 UG",
    imei: "18270192759",
    fleet_name: "JURAGAN99",
    vehicle_type: "Passenger car",
    install_date: new Date("2025-04-02"),
    status: "active",
  },
  {
    name: "Larva",
    display_name: "LARVA ( N  7434 UG )",
    lpn: "N 7434 UG",
    imei: "18270192751",
    fleet_name: "JURAGAN99",
    vehicle_type: "Passenger car",
    install_date: new Date("2025-04-02"),
    status: "active",
  },
  {
    name: "Masha",
    display_name: "MASHA ( N 7435 UG )",
    lpn: "N 7435 UG",
    imei: "18270192288",
    fleet_name: "JURAGAN99",
    vehicle_type: "Passenger car",
    install_date: new Date("2025-04-02"),
    status: "active",
  },
  {
    name: "Pinochio",
    display_name: "PINOCCHIO ( N 7436 UG )",
    lpn: "N 7436 UG",
    imei: "18270191954",
    fleet_name: "JURAGAN99",
    vehicle_type: "Passenger car",
    install_date: new Date("2025-04-02"),
    status: "active",
  },
  {
    name: "The bear",
    display_name: "THE BEAR ( N 7438 UG )",
    lpn: "N 7438 UG",
    imei: "18270192754",
    fleet_name: "JURAGAN99",
    vehicle_type: "Passenger car",
    install_date: new Date("2025-04-02"),
    status: "active",
  },
  {
    name: "Labubu",
    display_name: "LABUBU ( N  7439 UG )",
    lpn: "N 7439 UG",
    imei: "18270192755",
    fleet_name: "JURAGAN99",
    vehicle_type: "Passenger car",
    install_date: new Date("2025-04-02"),
    status: "active",
  },
  {
    name: "Boboiboy",
    display_name: "BOBOIBOY ( N 7440 UG )",
    lpn: "N 7440 UG",
    imei: "18270193134",
    fleet_name: "JURAGAN99",
    vehicle_type: "Passenger car",
    install_date: new Date("2025-04-02"),
    status: "active",
  },
  {
    name: "Silvester",
    display_name: "SILVESTER  ( N 7442 UG )",
    lpn: "N 7442 UG",
    imei: "18270192749",
    fleet_name: "JURAGAN99",
    vehicle_type: "Passenger car",
    install_date: new Date("2025-04-02"),
    status: "active",
  },
];

async function seedVehicles() {
  try {
    const mongoUri = process.env.MONGO_URI || "mongodb://root:example@mongo:27017/alertsDB?authSource=admin";

    console.log("Connecting to MongoDB...");
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✓ Connected to MongoDB");

    const existingCount = await Vehicle.countDocuments();

    if (existingCount > 0) {
      console.log(`⚠ Database already has ${existingCount} vehicles`);
      console.log("\nClearing existing vehicles...");
      await Vehicle.deleteMany({});
      console.log("✓ Cleared existing vehicles");
    }

    console.log("\nSeeding vehicles with IMEI mapping...");
    const result = await Vehicle.insertMany(vehiclesData);
    console.log(`✓ Successfully seeded ${result.length} vehicles`);

    console.log("\nVehicles list:");
    result.forEach((v, i) => {
      console.log(`${i + 1}. ${v.display_name} - IMEI: ${v.imei}`);
    });

    mongoose.connection.close();
    console.log("\n✓ Database connection closed");
    process.exit(0);
  } catch (err) {
    console.error("✗ Error seeding vehicles:", err);
    mongoose.connection.close();
    process.exit(1);
  }
}

seedVehicles();
