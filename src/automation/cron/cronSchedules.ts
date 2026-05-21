import { cronConfig } from '../../lib/automation/config';

export function getProductTaggerSchedule(): string {
  return cronConfig.productTaggerSchedule;
}

export function getRecentProductSyncSchedule(): string {
  return cronConfig.recentProductSyncSchedule;
}

export function getBarcodeSyncSchedule(): string {
  return cronConfig.barcodeSyncSchedule;
}

export function isProductTaggerEnabled(): boolean {
  return cronConfig.productTaggerEnabled;
}

export function isRecentProductSyncEnabled(): boolean {
  // Reuse product tagger enable flag or add a specific one if needed
  return cronConfig.productTaggerEnabled;
}

export function isBarcodeSyncEnabled(): boolean {
  return cronConfig.barcodeSyncEnabled;
}

export function getLogPurgeSchedule(): string {
  return cronConfig.logPurgeSchedule;
}

export function isLogPurgeEnabled(): boolean {
  return cronConfig.logPurgeEnabled;
}

export function getLogRetentionDays(): number {
  return cronConfig.logRetentionDays;
}

export function isVibeCheckReminderEnabled(): boolean {
  return cronConfig.vibeCheckReminderEnabled;
}
