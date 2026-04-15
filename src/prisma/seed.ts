import { prisma } from '../prisma/prisma';
import bcrypt from "bcryptjs";

export async function seedDatabase() {

    const isAlreadySeeded = await prisma.user.findFirst();
    if (isAlreadySeeded) {
        console.log("Database already seeded, skipping...");
        return;
    }

    // Create admin user
    const hash = await bcrypt.hash("password", 10);
    await prisma.user.create({
        data: {
            name: "Administrator",
            username: "admin",
            password: hash,
            role: "ADMIN",
            address: "123 Admin Street",
            phone: "1234567890",
        },
    });

    // Create default Chart of Accounts
    await prisma.account.createMany({
        data: [
            { code: "1001", name: "Cash", type: "ASSET" },
            { code: "1002", name: "Card", type: "ASSET" },
            { code: "1003", name: "JazzCash", type: "ASSET" },
        ],
    });

    // await prisma.category.createMany({
    //     data: [
    //         { name: "Beverages" },
    //         { name: "Snacks" },
    //         { name: "Dairy" },
    //     ],
    // });

    // await prisma.brand.createMany({
    //     data: [
    //         { name: "Coca-Cola" },
    //         { name: "Pepsi" },
    //         { name: "Lays" },
    //         { name: "Doritos" },
    //         { name: "Nestle" },
    //         { name: "Unilever" },
    //     ],
    // });

    // await prisma.product.createMany({
    //     data: [
    //         { name: "Coca-Cola", brandId: 1, categoryId: 1, totalStock: 50, avgCostPrice: 30 },
    //         { name: "Pepsi", brandId: 2, categoryId: 1, totalStock: 60, avgCostPrice: 30 },
    //         { name: "Lays", brandId: 3, categoryId: 2, totalStock: 100, avgCostPrice: 20 },
    //         { name: "Doritos", brandId: 4, categoryId: 2, totalStock: 80, avgCostPrice: 20 },
    //         { name: "Nestle Milk", brandId: 5, categoryId: 3, totalStock: 40, avgCostPrice: 60 },
    //         { name: "Unilever Ice Cream", brandId: 6, categoryId: 3, totalStock: 30, avgCostPrice: 90 },
    //     ],
    // });

    // await prisma.productVariant.createMany({
    //     data: [
    //         { productId: 1, barcode: "A001", name: "unit", price: 50, wholesale: 40, retail: 30 },
    //         { productId: 1, barcode: "A001A", name: "pet", price: 300, wholesale: 290, retail: 290, factor: 6 },
    //         { productId: 2, barcode: "A002", name: "unit", price: 50, wholesale: 40, retail: 30 },
    //         { productId: 3, barcode: "A003", name: "unit", price: 30, wholesale: 25, retail: 20 },
    //         { productId: 4, barcode: "A004", name: "unit", price: 30, wholesale: 25, retail: 20 },
    //         { productId: 5, barcode: "A005", name: "unit", price: 80, wholesale: 70, retail: 60 },
    //         { productId: 6, barcode: "A006", name: "unit", price: 120, wholesale: 100, retail: 90 },
    //     ]
    // });


    console.log("Database seeded successfully");
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
        });
}