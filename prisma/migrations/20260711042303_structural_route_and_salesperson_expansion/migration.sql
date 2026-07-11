/*
  Warnings:

  - You are about to drop the column `route` on the `stores` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX `stores_route_idx` ON `stores`;

-- AlterTable
ALTER TABLE `sales_persons` ADD COLUMN `address` VARCHAR(191) NULL,
    ADD COLUMN `email` VARCHAR(191) NULL,
    ADD COLUMN `nic` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `stores` DROP COLUMN `route`,
    ADD COLUMN `routeId` INTEGER NULL;

-- CreateTable
CREATE TABLE `routes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `routeCode` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `areaCoverage` VARCHAR(191) NULL,
    `deliverySchedule` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `routes_routeCode_key`(`routeCode`),
    UNIQUE INDEX `routes_name_key`(`name`),
    INDEX `routes_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `stores_routeId_idx` ON `stores`(`routeId`);

-- AddForeignKey
ALTER TABLE `stores` ADD CONSTRAINT `stores_routeId_fkey` FOREIGN KEY (`routeId`) REFERENCES `routes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
