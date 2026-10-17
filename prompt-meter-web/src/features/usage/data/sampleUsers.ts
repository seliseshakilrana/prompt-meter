export const SAMPLE_USERS = [
  { label: "Sample user (Dhaka, UTC+6)", timezone: "Asia/Dhaka", userId: "sample-user-dhaka" },
  { label: "Sample user (Kolkata, UTC+5:30)", timezone: "Asia/Kolkata", userId: "sample-user-kolkata" }
] as const;

export type SampleUser = (typeof SAMPLE_USERS)[number];
