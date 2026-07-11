-- Add optional sales person assignment at store profile level
ALTER TABLE `stores`
  ADD COLUMN `salesPersonId` VARCHAR(191) NULL;

-- Add index for relational lookups
CREATE INDEX `stores_salesPersonId_idx` ON `stores`(`salesPersonId`);

-- Enforce referential integrity for assigned sales person
ALTER TABLE `stores`
  ADD CONSTRAINT `stores_salesPersonId_fkey`
  FOREIGN KEY (`salesPersonId`) REFERENCES `sales_persons`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
