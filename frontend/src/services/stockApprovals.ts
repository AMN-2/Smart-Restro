import { call } from '@ury/core';

const API = 'ury.ury.api.stock_approvals';

export type DraftKind = 'consumption' | 'transfer' | 'issue';

export interface DraftItem {
  item_code: string;
  item_name: string;
  qty: number;
  uom: string;
  s_warehouse: string | null;
  t_warehouse: string | null;
  short: boolean;
}

export interface DraftEntry {
  name: string;
  kind: DraftKind;
  purpose: string;
  posting_date: string;
  posting_time: string;
  owner: string;
  owner_name: string;
  remarks: string | null;
  pos_invoice: string | null;
  from_warehouses: string[];
  to_warehouses: string[];
  value: number;
  short_items: string[];
  items: DraftItem[];
}

export interface DraftMaterial {
  item_code: string;
  item_name: string;
  stock_uom: string;
  warehouse: string;
  out_qty: number;
  in_qty: number;
  on_hand: number;
  after: number;
  short: boolean;
}

export interface DraftList {
  from_date: string;
  to_date: string;
  today: string;
  entries: DraftEntry[];
  materials: DraftMaterial[];
  truncated: boolean;
  older_count: number;
  approval_on: boolean;
}

export interface ApprovalSetup {
  company: string;
  currency: string;
  warehouses: { name: string; label: string }[];
  default_from: string | null;
  default_to: string | null;
  today: string;
  approval_on: boolean;
  permissions: { create: boolean; approve: boolean; delete: boolean };
}

export interface Material {
  item_code: string;
  item_name: string;
  item_group: string;
  stock_uom: string;
  uoms: { uom: string; conversion_factor: number }[];
  available_qty: number | null;
}

export interface TransferInput {
  from_warehouse: string;
  to_warehouse: string;
  posting_date?: string;
  remarks?: string;
  items: { item_code: string; qty: number; uom: string }[];
}

export interface ApproveResult {
  approved: number;
  failed: number;
  results: { name: string; ok: boolean; error: string | null }[];
}

/** The server takes at most 50 per call; smaller batches keep progress moving. */
export const APPROVE_BATCH = 20;

const unwrap = <T,>(res: unknown): T => ((res as { message?: T })?.message ?? res) as T;

export const stockApprovalService = {
  async setup(branch: string | undefined): Promise<ApprovalSetup> {
    return unwrap(await call(`${API}.get_setup`, { branch }));
  },
  async drafts(branch: string | undefined, from_date: string, to_date: string): Promise<DraftList> {
    return unwrap(await call(`${API}.get_drafts`, { branch, from_date, to_date }));
  },
  async searchMaterials(term: string, warehouse?: string): Promise<Material[]> {
    return unwrap(await call(`${API}.search_materials`, { term, warehouse }));
  },
  async createTransfer(data: TransferInput): Promise<{ name: string }> {
    return unwrap(await call(`${API}.create_transfer`, { data: JSON.stringify(data) }));
  },
  async approve(names: string[]): Promise<ApproveResult> {
    return unwrap(await call(`${API}.approve`, { names: JSON.stringify(names) }));
  },
  async remove(names: string[]): Promise<{ deleted: string[]; refused: string[] }> {
    return unwrap(await call(`${API}.delete_drafts`, { names: JSON.stringify(names) }));
  },
};

// --------------------------------------------------------------------------- counts

const COUNTS = 'ury.ury.api.stock_counts';

export interface CountSheetRow {
  item_code: string;
  item_name: string;
  item_group: string;
  stock_uom: string;
  system_qty: number;
  pending_qty: number;
  expected_qty: number;
  valuation_rate: number;
}

export interface CountSheet {
  warehouse: string;
  today: string;
  open_count: string | null;
  item_groups: string[];
  rows: CountSheetRow[];
}

export interface CountRequest {
  name: string;
  warehouse: string | null;
  posting_date: string;
  posting_time: string;
  owner: string;
  owner_name: string;
  remarks: string | null;
  value_difference: number;
  rows: {
    item_code: string;
    item_name: string;
    stock_uom: string;
    warehouse: string;
    counted_qty: number;
    expected_qty: number;
    difference: number;
    valuation_rate: number;
  }[];
}

export const stockCountService = {
  async sheet(warehouse: string, rawOnly: boolean): Promise<CountSheet> {
    return unwrap(await call(`${COUNTS}.get_count_sheet`, { warehouse, raw_only: rawOnly ? 1 : 0 }));
  },
  async submit(warehouse: string, lines: { item_code: string; counted_qty: number }[], remarks?: string) {
    return unwrap<{ name: string | null; differences: number }>(
      await call(`${COUNTS}.submit_count`, { warehouse, lines: JSON.stringify(lines), remarks }),
    );
  },
  async list(branch: string | undefined): Promise<{ counts: CountRequest[]; can_approve: boolean }> {
    return unwrap(await call(`${COUNTS}.get_counts`, { branch }));
  },
  async approve(name: string) {
    return unwrap(await call(`${COUNTS}.approve_count`, { name }));
  },
  async reject(name: string, reason?: string) {
    return unwrap(await call(`${COUNTS}.reject_count`, { name, reason }));
  },
};

// --------------------------------------------------------------------------- daily report

export interface DailyStockRow {
  item_code: string;
  item_name: string;
  item_group: string | null;
  stock_uom: string | null;
  warehouse: string;
  opening: number;
  purchase: number;
  transfer_in: number;
  transfer_out: number;
  sale_consumption: number;
  direct_sale: number;
  waste: number;
  adjustment: number;
  other: number;
  closing: number;
  pending_out: number;
  pending_in: number;
  after_pending: number;
  consumption_cost: number;
  valuation_rate: number;
  short: boolean;
}

export interface DailyStockReport {
  date: string;
  today: string;
  warehouses: { name: string; label: string }[];
  warehouse: string | null;
  raw_only: boolean;
  rows: DailyStockRow[];
  totals: { consumption_cost: number; materials: number; short: number; pending: number };
  by_product: {
    item_code: string;
    item_name: string;
    sold_qty: number;
    cost: number;
    has_draft: boolean;
    ingredients: { item_code: string; item_name: string; qty: number; stock_uom: string; cost: number }[];
  }[];
  transfers: {
    name: string;
    status: 'posted' | 'draft';
    posting_time: string;
    owner_name: string;
    remarks: string | null;
    items: { item_name: string; qty: number; uom: string; from: string | null; to: string | null }[];
  }[];
}

export const dailyStockService = {
  async report(params: { date: string; branch?: string; warehouse?: string; raw_only: boolean }): Promise<DailyStockReport> {
    return unwrap(
      await call('ury.ury.api.stock_reports.get_daily_stock_report', {
        ...params,
        raw_only: params.raw_only ? 1 : 0,
      }),
    );
  },
};
