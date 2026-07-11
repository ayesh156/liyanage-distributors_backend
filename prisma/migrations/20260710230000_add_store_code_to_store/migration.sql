ALTER TABLE `stores`
    ADD COLUMN `storeCode` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `stores_storeCode_key`
    ON `stores`(`storeCode`);
