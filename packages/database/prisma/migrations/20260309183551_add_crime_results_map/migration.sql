/*
  Warnings:

  - You are about to drop the `CrimeResult` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "CrimeResult" DROP CONSTRAINT "CrimeResult_query_id_fkey";

-- DropTable
DROP TABLE "CrimeResult";

-- CreateTable
CREATE TABLE "crime_results" (
    "id" SERIAL NOT NULL,
    "query_id" TEXT NOT NULL,
    "persistent_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "outcome_category" TEXT,
    "outcome_date" TEXT,
    "location_type" TEXT NOT NULL,
    "context" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crime_results_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "crime_results" ADD CONSTRAINT "crime_results_query_id_fkey" FOREIGN KEY ("query_id") REFERENCES "Query"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
