/*
  Warnings:

  - The primary key for the `CrimeResult` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `createdAt` on the `CrimeResult` table. All the data in the column will be lost.
  - You are about to drop the column `queryId` on the `CrimeResult` table. All the data in the column will be lost.
  - You are about to drop the column `raw` on the `CrimeResult` table. All the data in the column will be lost.
  - The `id` column on the `CrimeResult` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `createdAt` on the `Query` table. All the data in the column will be lost.
  - The primary key for the `SchemaVersion` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `appliedAt` on the `SchemaVersion` table. All the data in the column will be lost.
  - You are about to drop the column `sql` on the `SchemaVersion` table. All the data in the column will be lost.
  - You are about to drop the column `triggeredBy` on the `SchemaVersion` table. All the data in the column will be lost.
  - The `id` column on the `SchemaVersion` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `location_type` to the `CrimeResult` table without a default value. This is not possible if the table is not empty.
  - Added the required column `persistent_id` to the `CrimeResult` table without a default value. This is not possible if the table is not empty.
  - Added the required column `query_id` to the `CrimeResult` table without a default value. This is not possible if the table is not empty.
  - Made the column `street` on table `CrimeResult` required. This step will fail if there are existing NULL values in that column.
  - Made the column `month` on table `CrimeResult` required. This step will fail if there are existing NULL values in that column.
  - Made the column `latitude` on table `CrimeResult` required. This step will fail if there are existing NULL values in that column.
  - Made the column `longitude` on table `CrimeResult` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `category` to the `Query` table without a default value. This is not possible if the table is not empty.
  - Added the required column `date` to the `Query` table without a default value. This is not possible if the table is not empty.
  - Added the required column `poly` to the `Query` table without a default value. This is not possible if the table is not empty.
  - Added the required column `viz_hint` to the `Query` table without a default value. This is not possible if the table is not empty.
  - Added the required column `column_name` to the `SchemaVersion` table without a default value. This is not possible if the table is not empty.
  - Added the required column `column_type` to the `SchemaVersion` table without a default value. This is not possible if the table is not empty.
  - Added the required column `table_name` to the `SchemaVersion` table without a default value. This is not possible if the table is not empty.
  - Added the required column `triggered_by` to the `SchemaVersion` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "CrimeResult" DROP CONSTRAINT "CrimeResult_queryId_fkey";

-- AlterTable
ALTER TABLE "CrimeResult" DROP CONSTRAINT "CrimeResult_pkey",
DROP COLUMN "createdAt",
DROP COLUMN "queryId",
DROP COLUMN "raw",
ADD COLUMN     "context" TEXT,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "location_type" TEXT NOT NULL,
ADD COLUMN     "outcome_category" TEXT,
ADD COLUMN     "outcome_date" TEXT,
ADD COLUMN     "persistent_id" TEXT NOT NULL,
ADD COLUMN     "query_id" TEXT NOT NULL,
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ALTER COLUMN "street" SET NOT NULL,
ALTER COLUMN "month" SET NOT NULL,
ALTER COLUMN "latitude" SET NOT NULL,
ALTER COLUMN "longitude" SET NOT NULL,
ADD CONSTRAINT "CrimeResult_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Query" DROP COLUMN "createdAt",
ADD COLUMN     "category" TEXT NOT NULL,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "date" TEXT NOT NULL,
ADD COLUMN     "poly" TEXT NOT NULL,
ADD COLUMN     "viz_hint" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "SchemaVersion" DROP CONSTRAINT "SchemaVersion_pkey",
DROP COLUMN "appliedAt",
DROP COLUMN "sql",
DROP COLUMN "triggeredBy",
ADD COLUMN     "column_name" TEXT NOT NULL,
ADD COLUMN     "column_type" TEXT NOT NULL,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "table_name" TEXT NOT NULL,
ADD COLUMN     "triggered_by" TEXT NOT NULL,
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "SchemaVersion_pkey" PRIMARY KEY ("id");

-- AddForeignKey
ALTER TABLE "CrimeResult" ADD CONSTRAINT "CrimeResult_query_id_fkey" FOREIGN KEY ("query_id") REFERENCES "Query"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
