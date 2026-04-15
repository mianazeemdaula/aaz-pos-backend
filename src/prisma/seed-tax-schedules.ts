import { prisma } from './prisma';
import bcrypt from "bcryptjs";

export async function seedDatabase() {

    const isAlreadySeeded = await prisma.taxSchdule.findFirst();
    if (isAlreadySeeded) {
        console.log("Database already seeded, skipping...");
        return;
    }
    await prisma.taxSchdule.createMany({
        data: [
            { name: "Tea (Branded/Retail)", hscode: "0902.3000", rate: 18 },
            { name: "Coffee (Imported/Retail)", hscode: "0901.2100", rate: 18 },
            { name: "Spices (Branded/Packaged)", hscode: "0910.0000", rate: 18 },
            { name: "Biscuits (Packaged)", hscode: "1905.3100", rate: 18 },
            { name: "Cakes & Pastries (3 Milk Cake, etc.)", hscode: "1905.9000", rate: 18 },
            { name: "Chocolates (Branded/Imported)", hscode: "1806.9000", rate: 18 },
            { name: "Dry Fruit & Nut Mix (Retail Pack)", hscode: "0813.5000", rate: 18 },
            { name: "Juices (Branded/Packaged)", hscode: "2009.1100", rate: 18 },
            { name: "Soft Drinks (Branded/Packaged)", hscode: "2202.1000", rate: 18 },
            { name: "Ice Cream (Branded/Packaged)", hscode: "2105.0000", rate: 18 },
            { name: "Powdered Drinks (Tang, etc.)", hscode: "2106.9090", rate: 18 },
            { name: "Energy Drinks (Branded/Packaged)", hscode: "2202.9000", rate: 18 },
            { name: "Snack Foods (Branded/Packaged)", hscode: "1905.9000", rate: 18 },
            { name: "Cooking Oil (Branded/Packaged)", hscode: "1512.0000", rate: 18 },
            { name: "Ghee (Branded/Packaged)", hscode: "0405.1000", rate: 18 },
            { name: "Butter (Branded/Packaged)", hscode: "0405.2000", rate: 18 },
            { name: "Margarine (Branded/Packaged)", hscode: "1517.1000", rate: 18 },
            { name: "Yogurt (Branded/Packaged)", hscode: "0403.9000", rate: 18 },
            { name: "Milk (Branded/Packaged)", hscode: "0401.1000", rate: 18 },
            { name: "Flour (Branded/Packaged)", hscode: "1101.0000", rate: 18 },
            { name: "Rice (Branded/Packaged)", hscode: "1006.3000", rate: 18 },
            { name: "Sugar (Branded/Packaged)", hscode: "1701.9000", rate: 18 },
            { name: "Salt (Branded/Packaged)", hscode: "2501.0000", rate: 18 },
            { name: "Pulses (Branded/Packaged)", hscode: "0713.0000", rate: 18 },
            { name: "Canned Foods (Branded/Packaged)", hscode: "2001.1000", rate: 18 },
            { name: "Frozen Foods (Branded/Packaged)", hscode: "2106.9090", rate: 18 },
            { name: "Ready-to-Eat Meals (Branded/Packaged)", hscode: "2106.9090", rate: 18 },
            { name: "Pet Food (Branded/Packaged)", hscode: "2309.1000", rate: 18 },
            { name: "Baby Food (Branded/Packaged)", hscode: "1901.1000", rate: 18 },
            { name: "Health Supplements (Branded/Packaged)", hscode: "2106.9090", rate: 18 },
            { name: "Personal Care Products (Branded/Packaged)", hscode: "3304.9900", rate: 18 },
            { name: "Household Cleaning Products (Branded/Packaged)", hscode: "3402.2000", rate: 18 },
            { name: "Paper Products (Branded/Packaged)", hscode: "4818.1000", rate: 18 },
            { name: "Stationery (Branded/Packaged)", hscode: "4820.1000", rate: 18 },
            { name: "Toys & Games (Branded/Packaged)", hscode: "9503.0000", rate: 18 },
            { name: "Clothing (Branded/Packaged)", hscode: "6109.1000", rate: 18 },
            { name: "Footwear (Branded/Packaged)", hscode: "6403.5910", rate: 18 },
            { name: "Electronics (Branded/Packaged)", hscode: "8517.1200", rate: 18 },
            { name: "Appliances (Branded/Packaged)", hscode: "8415.1000", rate: 18 },
            { name: "Furniture (Branded/Packaged)", hscode: "9403.6000", rate: 18 },
            { name: "Automotive Parts (Branded/Packaged)", hscode: "8708.9990", rate: 18 },
            { name: "Hardware & Tools (Branded/Packaged)", hscode: "8205.2000", rate: 18 },
            { name: "Sports Equipment (Branded/Packaged)", hscode: "9506.9100", rate: 18 },
            { name: "Books & Magazines (Branded/Packaged)", hscode: "4901.0000", rate: 18 },
            { name: "Music & Movies (Branded/Packaged)", hscode: "8523.4900", rate: 18 },
            { name: "Office Supplies (Branded/Packaged)", hscode: "4820.1000", rate: 18 },
            { name: "Gardening Supplies (Branded/Packaged)", hscode: "0602.9000", rate: 18 },
            { name: "Petroleum Products (Branded/Packaged)", hscode: "2710.0000", rate: 18 },
            { name: "Chemicals (Branded/Packaged)", hscode: "3824.9000", rate: 18 },
            { name: "Pharmaceuticals (Branded/Packaged)", hscode: "3004.9000", rate: 18 },
        ],
    });

    console.log("Tax schedules seeded successfully");

}

if (require.main === module) {
    seedDatabase()
        .catch((e) => {
            console.error(e);
            process.exitCode = 1;
        })
        .finally(async () => {
            await prisma.$disconnect();
            console.log("Seeding completed");
            process.exit(0);
        });
}