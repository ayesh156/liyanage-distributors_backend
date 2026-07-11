-- CreateTable
CREATE TABLE `stores` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `address` TEXT NULL,
    `route` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `stores_name_idx`(`name`),
    INDEX `stores_route_idx`(`route`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_persons` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `sales_persons_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` VARCHAR(191) NOT NULL,
    `documentNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `docType` ENUM('Invoice', 'CreditNote', 'DebitNote', 'Receipt') NOT NULL DEFAULT 'Invoice',
    `description` TEXT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `received` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `balanceDue` DECIMAL(14, 2) NOT NULL,
    `status` ENUM('paid', 'pending', 'overdue', 'cancelled') NOT NULL DEFAULT 'pending',
    `chequeNo` VARCHAR(191) NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `salesPersonId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `invoices_documentNo_key`(`documentNo`),
    INDEX `invoices_documentNo_idx`(`documentNo`),
    INDEX `invoices_storeId_idx`(`storeId`),
    INDEX `invoices_salesPersonId_idx`(`salesPersonId`),
    INDEX `invoices_date_idx`(`date`),
    INDEX `invoices_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `amountPaid` DECIMAL(14, 2) NOT NULL,
    `description` TEXT NULL,
    `paymentMethod` ENUM('cash', 'card', 'bank_transfer', 'credit', 'cheque') NOT NULL DEFAULT 'cash',
    `chequeNo` VARCHAR(191) NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payments_invoiceId_idx`(`invoiceId`),
    INDEX `payments_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_counters` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `prefix` VARCHAR(191) NOT NULL DEFAULT 'INV-',
    `seq` INTEGER NOT NULL DEFAULT 0,
    `year` INTEGER NOT NULL DEFAULT 2026,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_salesPersonId_fkey` FOREIGN KEY (`salesPersonId`) REFERENCES `sales_persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
