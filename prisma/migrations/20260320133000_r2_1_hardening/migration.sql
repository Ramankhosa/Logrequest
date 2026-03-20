-- Harden persisted review cycles against invalid manual inserts
ALTER TABLE "ReviewCycle"
ADD CONSTRAINT "ReviewCycle_cycleNumber_positive"
CHECK ("cycleNumber" > 0);
