import type { Invoice } from "./invoice"

export function reportTotal(invoice: Invoice): number {
  return invoice.items[0] ?? 0
}
