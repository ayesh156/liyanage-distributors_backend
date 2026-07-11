-- AlterTable
ALTER TABLE `invoices` ADD COLUMN `bankName` VARCHAR(191) NULL,
    ADD COLUMN `branchName` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `payments` ADD COLUMN `branchName` VARCHAR(191) NULL;
