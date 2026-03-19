-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "currentLat" DOUBLE PRECISION,
ADD COLUMN     "currentLng" DOUBLE PRECISION,
ADD COLUMN     "isBusy" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastLocationAt" TIMESTAMP(3),
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "suspendedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarUrl" TEXT;

-- CreateTable
CREATE TABLE "PricingConfig" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "vehicleType" TEXT,
    "perKmPrice" DOUBLE PRECISION NOT NULL DEFAULT 12000,
    "perMinPrice" DOUBLE PRECISION NOT NULL DEFAULT 500,
    "nightMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.3,
    "rushHourMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.2,
    "badWeatherFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PricingConfig_name_key" ON "PricingConfig"("name");
