import { BarChart3, CircleDollarSign, Database, UserRound } from "lucide-react";

export const navItems = [
  { href: "/", labelKey: "nav.myUsage", icon: BarChart3 },
  { href: "/prices", labelKey: "nav.prices", icon: CircleDollarSign },
  { href: "/admin/seed", labelKey: "nav.seed", icon: Database },
  { href: "/profile", labelKey: "nav.profile", icon: UserRound }
] as const;
