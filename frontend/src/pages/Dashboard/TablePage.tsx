import React, { useState, useEffect, useMemo } from 'react';
import { useFloorUpdates } from '../../lib/floorSync';
import { useBranchContext } from '../../context/BranchContext';
import { Grid, Plus, Users, List, Edit2, LayoutTemplate, Clock, Filter, Link2 } from 'lucide-react';
import { Card, Button, Badge, Input, Spinner, showToast, Illustration, TableScene, cn } from '@ury/ui';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { Switch } from '../../components/ui/switch';
import { dashboardService } from '../../services/dashboard';
import { call, compareNatural, formatElapsed, minutesSince } from '@ury/core';
import SideDrawer from '../../components/layout/SideDrawer';
import TableLayoutView from './TableLayoutView';
import { tableStatusLabel } from '../../lib/statusLabels';
import { t } from '../../i18n';
import { LoadErrorBanner } from '../../components/common/LoadErrorBanner';

interface UryTableRecord {
  name: string;
  table_name?: string;
  no_of_seats?: number;
  minimum_seating?: number;
  restaurant?: string;
  restaurant_room?: string;
  branch?: string;
  table_shape?: string;
  is_take_away?: boolean;
  // Frappe returns Check fields as 0/1, not booleans.
  enable_self_ordering?: number | boolean;
  occupied?: number;
  latest_invoice_time?: string | null;
  merged_with?: string | null;
}

const VIEW_MODE_KEY = 'ury_dash_tables_view';
const OCCUPIED_ONLY_KEY = 'ury_dash_tables_occupied_only';

/** Per-device conveniences; blocked storage just means the defaults. */
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* blocked storage: the choice still holds for this visit */
  }
}

const isOccupied = (table: UryTableRecord) => table.occupied === 1;

/**
 * The floor card, in the same design as the cashier and waiter screens:
 * a status rail, the 3D table painted in the state's colour, and the name
 * as the largest thing on it. Clicking opens the editor.
 */
const ManagerTableCard: React.FC<{
  table: UryTableRecord;
  index: number;
  now: Date;
  onEdit: () => void;
}> = ({ table, index, now, onEdit }) => {
  const occupied = isOccupied(table);
  const elapsed = occupied ? formatElapsed(minutesSince(table.latest_invoice_time, now)) : null;
  const seats = table.no_of_seats || 0;

  return (
    <button
      type="button"
      onClick={onEdit}
      style={{ '--i': index } as React.CSSProperties}
      aria-label={`${t('dash.table.edit_table')}: ${table.table_name || table.name}`}
      className={cn(
        'group relative flex min-h-[16rem] flex-col rounded-2xl border border-gray-200 bg-white text-start shadow-sm',
        'animate-fade-in-up stagger-fast transition-[box-shadow,transform] duration-200 ease-out',
        'hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'
      )}
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 start-0 w-1.5 rounded-s-2xl', occupied ? 'bg-amber-400' : 'bg-emerald-500')}
      />

      <div className="flex w-full items-start justify-between gap-2 pe-3 ps-4 pt-3">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold',
            occupied ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          )}
        >
          <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full bg-current', occupied && 'animate-pulse-soft')} />
          {tableStatusLabel(occupied ? 'Occupied' : 'Available')}
        </span>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Edit2 className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>

      <div className="flex w-full flex-1 flex-col px-4 pt-1 text-center">
        <TableScene state={occupied ? 'occupied' : 'free'} />
        <h3 className="flex items-center justify-center gap-1.5 text-2xl font-bold leading-tight tracking-tight text-gray-900">
          <span className="truncate">{table.table_name || table.name}</span>
          {table.merged_with ? <Link2 className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" /> : null}
        </h3>
        {occupied ? (
          <p className="mt-1 flex items-center justify-center gap-1 text-sm font-semibold tabular-nums text-gray-500">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            <bdi>{elapsed}</bdi>
          </p>
        ) : (
          <p className="mt-1 flex items-center justify-center gap-1 text-sm text-gray-500">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            {t('dash.table.seats_count', { count: seats })}
          </p>
        )}
      </div>

      <div className="mt-3 flex w-full items-center justify-between gap-2 border-t border-gray-100 px-4 py-2.5 text-xs font-medium text-gray-500">
        <span className="truncate">{table.restaurant_room || '—'}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {table.is_take_away ? (
            <Badge variant="outline" size="sm" className="border-sky-200 bg-sky-50 text-sky-800">
              {t('dash.table.is_take_away_table')}
            </Badge>
          ) : null}
          <Badge variant="outline" size="sm" className="border-gray-200 bg-gray-50 text-gray-600">
            {table.table_shape || 'Square'}
          </Badge>
        </span>
      </div>
    </button>
  );
};

export const TablePage: React.FC = () => {
  const { activeBranchId } = useBranchContext();
  const [tables, setTables] = useState<UryTableRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<boolean>(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  // The floor cards are the default: the manager reads this page as "how is
  // the floor right now" first and as a settings list second.
  const [viewMode, setViewModeState] = useState<'grid' | 'list' | 'layout'>(() =>
    readStored(VIEW_MODE_KEY) === 'list' ? 'list' : 'grid'
  );
  const setViewMode = (mode: 'grid' | 'list' | 'layout') => {
    setViewModeState(mode);
    if (mode !== 'layout') writeStored(VIEW_MODE_KEY, mode);
  };
  const [occupiedOnly, setOccupiedOnly] = useState<boolean>(() => readStored(OCCUPIED_ONLY_KEY) === '1');
  const toggleOccupiedOnly = () => {
    setOccupiedOnly((prev) => {
      writeStored(OCCUPIED_ONLY_KEY, prev ? '0' : '1');
      return !prev;
    });
  };
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const [editingTable, setEditingTable] = useState<UryTableRecord | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  // Branch options from Branch doctype
  const [branches, setBranches] = useState<{ name: string }[]>([]);
  // Room options from URY Room doctype
  const [rooms, setRooms] = useState<{ name: string; room_name?: string }[]>([]);

  const [newTable, setNewTable] = useState({
    table_name: '',
    no_of_seats: '4',
    minimum_seating: '1',
    branch: '',
    restaurant_room: '',
    table_shape: 'Square',
    is_take_away: false,
    // New tables carry the code by default, the same as every table did
    // before the switch existed — a restaurant turns a table off, it does
    // not have to turn forty on.
    enable_self_ordering: true,
  });

  const fetchBranches = async () => {
    try {
      const res = await dashboardService.getModuleRecords<{ name: string }>('Branch', 'all');
      setBranches(res || []);
    } catch {
      setBranches([]);
    }
  };

  const fetchRooms = async () => {
    try {
      const res = await dashboardService.getModuleRecords<{ name: string; room_name?: string }>('URY Room', activeBranchId);
      setRooms(res || []);
    } catch {
      setRooms([]);
    }
  };

  const fetchTables = async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true);
    try {
      const records = await dashboardService.getModuleRecords<UryTableRecord>('URY Table', activeBranchId);
      setTables(records);
      setLoadError(false);
    } catch {
      // Not `setTables([])`: an empty table list is a real state, and
      // showing it here would hide the failure behind a plausible answer.
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBranches();
    fetchRooms();
    fetchTables();
  }, [activeBranchId]);

  // Live: occupancy and merges change on the floor while this page is open.
  useFloorUpdates(() => {
    void fetchTables({ silent: true });
  }, { branch: activeBranchId });

  const openAddDrawer = () => {
    setEditingTable(null);
    setNewTable({
      table_name: '',
      no_of_seats: '4',
      minimum_seating: '1',
      branch: activeBranchId !== 'all' ? activeBranchId : '',
      restaurant_room: '',
      table_shape: 'Square',
      is_take_away: false,
      enable_self_ordering: true,
    });
    setIsDrawerOpen(true);
  };

  const openEditDrawer = (table: UryTableRecord) => {
    setEditingTable(table);
    setNewTable({
      table_name: table.table_name || table.name || '',
      no_of_seats: table.no_of_seats?.toString() || '4',
      minimum_seating: table.minimum_seating?.toString() || '1',
      branch: table.branch || '',
      restaurant_room: table.restaurant_room || '',
      table_shape: table.table_shape || 'Square',
      is_take_away: !!table.is_take_away,
      enable_self_ordering: table.enable_self_ordering !== 0 && table.enable_self_ordering !== false,
    });
    setIsDrawerOpen(true);
  };

  const handleSaveTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTable.table_name) return;

    if (!newTable.restaurant_room || !newTable.restaurant_room.trim()) {
      showToast.warning(t('dash.table.please_select_a_room_for_the_table'));
      return;
    }

    setSaving(true);
    try {
      if (editingTable) {
        const original = {
          table_name: editingTable.table_name || editingTable.name || '',
          no_of_seats: parseInt(editingTable.no_of_seats as any) || 0,
          minimum_seating: parseInt(editingTable.minimum_seating as any) || 0,
          branch: editingTable.branch || '',
          restaurant_room: editingTable.restaurant_room || '',
          table_shape: editingTable.table_shape || 'Square',
          is_take_away: editingTable.is_take_away ? 1 : 0,
          enable_self_ordering: editingTable.enable_self_ordering === 0 || editingTable.enable_self_ordering === false ? 0 : 1,
        };
        const current = {
          table_name: newTable.table_name || '',
          no_of_seats: parseInt(newTable.no_of_seats as any) || 0,
          minimum_seating: parseInt(newTable.minimum_seating as any) || 0,
          branch: newTable.branch || '',
          restaurant_room: newTable.restaurant_room || '',
          table_shape: newTable.table_shape || 'Square',
          is_take_away: newTable.is_take_away ? 1 : 0,
          enable_self_ordering: newTable.enable_self_ordering ? 1 : 0,
        };
        if (JSON.stringify(original) === JSON.stringify(current)) {
          showToast.warning(t('dash.table.no_changes_in_document'));
          setSaving(false);
          return;
        }

        let currentName = editingTable.name;
        const branchName = newTable.branch || activeBranchId;
        const uniqueTableName = `${newTable.table_name} - ${branchName}`;
        if (uniqueTableName !== editingTable.name) {
          await call('frappe.client.rename_doc', {
            doctype: 'URY Table',
            old_name: editingTable.name,
            new_name: uniqueTableName,
          });
          currentName = uniqueTableName;
        }

        await call('frappe.client.set_value', {
          doctype: 'URY Table',
          name: currentName,
          fieldname: {
            table_name: newTable.table_name,
            no_of_seats: parseInt(newTable.no_of_seats),
            minimum_seating: parseInt(newTable.minimum_seating),
            branch: newTable.branch,
            restaurant_room: newTable.restaurant_room,
            table_shape: newTable.table_shape,
            is_take_away: newTable.is_take_away ? 1 : 0,
            enable_self_ordering: newTable.enable_self_ordering ? 1 : 0,
          },
        });
      } else {
        let restaurantName = '';
        if (newTable.branch) {
          try {
            const resList = await call<any>('frappe.client.get_list', {
              doctype: 'URY Restaurant',
              filters: [['branch', '=', newTable.branch]],
              fields: ['name'],
              limit: 1
            });
            const records = resList.message || resList || [];
            if (records.length > 0) {
              restaurantName = records[0].name;
            }
          } catch (err) {
            console.error('Failed to fetch restaurant for branch', err);
          }
        }
        if (!restaurantName) {
          showToast.error(t('dash.table.no_ury_restaurant_configured_for_this_branch'));
          return;
        }

        const branchName = newTable.branch || activeBranchId;
        const uniqueTableName = `${newTable.table_name} - ${branchName}`;

        await call('frappe.client.insert', {
          doc: {
            doctype: 'URY Table',
            name: uniqueTableName,
            table_name: newTable.table_name,
            restaurant: restaurantName,
            no_of_seats: parseInt(newTable.no_of_seats),
            minimum_seating: parseInt(newTable.minimum_seating),
            branch: newTable.branch || undefined,
            restaurant_room: newTable.restaurant_room,
            table_shape: newTable.table_shape,
            is_take_away: newTable.is_take_away ? 1 : 0,
            enable_self_ordering: newTable.enable_self_ordering ? 1 : 0,
          },
        });
      }
      showToast.success(t('dash.table.table_saved'));
      fetchTables();
      setIsDrawerOpen(false);
    } catch (err) {
      console.error('Failed to save URY Table', err);
      showToast.error(`Failed to save table: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  // Resolved out here because the row loop below binds `t` to the table
  // record, shadowing the translation function.
  // Room, then table, in counting order: "T2" before "T10".
  const sortedTables = useMemo(
    () =>
      [...tables].sort(
        (a, b) =>
          compareNatural(a.restaurant_room, b.restaurant_room) ||
          compareNatural(a.table_name || a.name, b.table_name || b.name)
      ),
    [tables]
  );
  const occupiedCount = useMemo(() => tables.filter(isOccupied).length, [tables]);
  const visibleTables = useMemo(
    () => (occupiedOnly ? sortedTables.filter(isOccupied) : sortedTables),
    [sortedTables, occupiedOnly]
  );

  const selfOrderingOnLabel = t('dash.table.self_ordering_on');
  const selfOrderingOffLabel = t('dash.table.self_ordering_off');

  return (
    <div className="space-y-6">
      {/* Toolbar — Partition Style */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 pb-3 border-b border-gray-200 -mx-6 px-6 -mt-6 pt-6">
        <div className="flex bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded-md flex items-center justify-center transition-colors ${viewMode === 'list' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
          >
            <List className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded-md flex items-center justify-center transition-colors ${viewMode === 'grid' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
          >
            <Grid className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {tables.length > 0 && (
            <div className="hidden items-center gap-3 text-xs font-semibold text-gray-500 lg:flex">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" aria-hidden="true" />
                {t('dash.table.free_count', { count: tables.length - occupiedCount })}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" aria-hidden="true" />
                {t('dash.table.occupied_count', { count: occupiedCount })}
              </span>
            </div>
          )}
          {viewMode !== 'layout' && (
            <Button
              variant="outline"
              aria-pressed={occupiedOnly}
              onClick={toggleOccupiedOnly}
              className={cn(
                'border-gray-300 text-gray-700 font-semibold flex items-center gap-1.5',
                occupiedOnly && 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
              )}
            >
              <Filter className="w-4 h-4" />
              <span>{t('dash.table.occupied_only')}</span>
              <span className="rounded-full bg-amber-100 px-1.5 text-xs tabular-nums text-amber-800">{occupiedCount}</span>
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => setViewMode('layout')}
            className={`border-gray-300 text-gray-700 font-semibold flex items-center gap-1.5 ${viewMode === 'layout' ? 'bg-primary/10 border-primary/30 text-primary' : ''}`}
          >
            <LayoutTemplate className="w-4 h-4" />
            <span>{t('dash.table.edit_layout')}</span>
          </Button>
          <Button
            onClick={openAddDrawer}
            className="bg-primary hover:bg-primary/90 text-white font-semibold flex items-center gap-1.5 shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>{t('dash.table.add_table')}</span>
          </Button>
        </div>
      </div>

      {loadError && <LoadErrorBanner onRetry={fetchTables} />}

      {loading ? (
        <div className="py-16 flex items-center justify-center bg-white rounded-lg border border-gray-200">
          <Spinner className="w-8 h-8 text-primary" />
        </div>
      ) : tables.length === 0 ? (
        <Card className="p-12 flex flex-col items-center justify-center text-center rounded-lg border border-gray-200 shadow-sm bg-white">
          <Illustration name="tables" className="mb-3" />
          <h3 className="text-lg font-semibold text-gray-900 mb-1">{t('dash.table.no_dining_tables_configured')}</h3>
          <p className="text-gray-500 mb-6 max-w-sm">{t('dash.table.add_dining_tables_to_configure_your_restaura')}</p>
          <Button
            onClick={openAddDrawer}
            className="bg-primary hover:bg-primary/90 text-white font-semibold flex items-center space-x-1.5 shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>{t('dash.table.add_table')}</span>
          </Button>
        </Card>
      ) : viewMode === 'layout' ? (
        <div className="bg-white border border-gray-200 rounded-lg shadow-xs overflow-hidden h-[600px] relative">
          <TableLayoutView
            selectedRoom="All"
            tables={tables as any}
            onBackToGrid={() => setViewMode('list')}
            onRefresh={fetchTables}
          />
        </div>
      ) : visibleTables.length === 0 ? (
        <Card className="p-12 flex flex-col items-center justify-center text-center rounded-lg border border-gray-200 shadow-sm bg-white">
          <Illustration name="tables" size="sm" className="mb-3" />
          <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('dash.table.no_occupied_tables')}</h3>
          <Button variant="outline" onClick={toggleOccupiedOnly}>
            {t('dash.table.show_all_tables')}
          </Button>
        </Card>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))] gap-5">
          {visibleTables.map((table, index) => (
            <ManagerTableCard key={table.name} table={table} index={index} now={now} onEdit={() => openEditDrawer(table)} />
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-start text-sm text-gray-600">
            <thead className="bg-gray-50 border-b border-gray-100 text-xs uppercase text-gray-500 font-semibold">
              <tr>
                <th className="px-6 py-4">{t('dash.table.table_name')}</th>
                <th className="px-6 py-4">{t('dash.table.room')}</th>
                <th className="px-6 py-4">{t('dash.table.seats')}</th>
                <th className="px-6 py-4">{t('dash.table.shape')}</th>
                <th className="px-6 py-4">{t('dash.table.status')}</th>
                <th className="px-6 py-4">{t('dash.table.self_ordering')}</th>
                <th className="px-6 py-4 text-end">{t('dash.table.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleTables.map((t) => (
                <tr key={t.name} className="hover:bg-primary/10 transition-colors">
                  <td className="px-6 py-4 font-semibold text-gray-900">{t.table_name || t.name}</td>
                  <td className="px-6 py-4">{t.restaurant_room || 'Main Hall'}</td>
                  <td className="px-6 py-4 font-mono">{t.no_of_seats || 4}</td>
                  <td className="px-6 py-4">
                    <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary text-[10px]">
                      {t.table_shape || 'Square'}
                    </Badge>
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant={isOccupied(t) ? 'warning' : 'success'} size="sm">
                      {tableStatusLabel(isOccupied(t) ? 'Occupied' : 'Available')}
                    </Badge>
                  </td>
                  <td className="px-6 py-4">
                    {/* Which tables carry a working code is the question staff
                        ask of the whole list, not one table at a time. */}
                    {t.enable_self_ordering === 0 || t.enable_self_ordering === false ? (
                      <Badge variant="outline" size="sm" className="border-gray-300 bg-gray-100 text-gray-600">
                        {selfOrderingOffLabel}
                      </Badge>
                    ) : (
                      <Badge variant="success" size="sm">
                        {selfOrderingOnLabel}
                      </Badge>
                    )}
                  </td>
                  <td className="px-6 py-4 text-end">
                    <Button variant="ghost" size="sm" onClick={() => openEditDrawer(t)} className="text-gray-500 hover:text-primary">
                      <Edit2 className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit SideDrawer */}
      <SideDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title={editingTable ? 'Edit Dining Table' : 'Add Dining Table'}
      >
        <form onSubmit={handleSaveTable} className="space-y-5">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">{t('dash.table.table_name')}</label>
              <Input
                value={newTable.table_name}
                onChange={(e) => setNewTable({ ...newTable, table_name: e.target.value })}
                required
                className="w-full"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">{t('dash.table.seats_capacity')}</label>
                <Input
                  type="number"
                  value={newTable.no_of_seats}
                  onChange={(e) => setNewTable({ ...newTable, no_of_seats: e.target.value })}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">{t('dash.table.min_seating')}</label>
                <Input
                  type="number"
                  value={newTable.minimum_seating}
                  onChange={(e) => setNewTable({ ...newTable, minimum_seating: e.target.value })}
                  className="w-full"
                />
              </div>
            </div>

            {/* Branch — Select from Branch doctype */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">{t('dash.table.branch')}</label>
              <SearchableSelect
                id="branch"
                value={newTable.branch}
                onChange={(_, value) => setNewTable({ ...newTable, branch: value })}
                options={[
                  { value: '', label: 'Select Branch' },
                  ...branches.map(b => ({ value: b.name, label: b.name }))
                ]}
              />
            </div>

            {/* Room — Select from URY Room docs */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">{t('dash.table.room')}</label>
              <SearchableSelect
                id="restaurant_room"
                value={newTable.restaurant_room}
                onChange={(_, value) => setNewTable({ ...newTable, restaurant_room: value })}
                options={[
                  { value: '', label: 'Select Room' },
                  ...rooms.map(r => ({ value: r.name, label: r.room_name || r.name }))
                ]}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">{t('dash.table.table_shape')}</label>
              <SearchableSelect
                id="table_shape"
                value={newTable.table_shape}
                onChange={(_, value) => setNewTable({ ...newTable, table_shape: value })}
                options={[
                  { value: 'Square', label: 'Square' },
                  { value: 'Rectangle', label: 'Rectangle' },
                  { value: 'Circle', label: 'Circle' },
                ]}
              />
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <Switch
                id="is_take_away"
                checked={newTable.is_take_away}
                onCheckedChange={(checked) => setNewTable({ ...newTable, is_take_away: checked })}
              />
              <label htmlFor="is_take_away" className="text-sm font-medium text-gray-700 cursor-pointer">{t('dash.table.is_take_away_table')}</label>
            </div>

            <div className="pt-2">
              <div className="flex items-center space-x-2">
                <Switch
                  id="enable_self_ordering"
                  checked={newTable.enable_self_ordering}
                  onCheckedChange={(checked) => setNewTable({ ...newTable, enable_self_ordering: checked })}
                />
                <label htmlFor="enable_self_ordering" className="text-sm font-medium text-gray-700 cursor-pointer">
                  {t('dash.table.enable_self_ordering')}
                </label>
              </div>
              <p className="mt-1 text-xs text-gray-500 ms-11">
                {t('dash.table.enable_self_ordering_hint')}
              </p>
            </div>
          </div>

          <div className="pt-6 flex justify-end gap-3 border-t border-gray-100">
            <Button type="button" variant="outline" onClick={() => setIsDrawerOpen(false)} disabled={saving}>{t('dash.table.cancel')}</Button>
            <Button type="submit" className="bg-primary hover:bg-primary/90 text-white shadow-sm" disabled={saving}>
              {editingTable ? 'Save Changes' : 'Save Table'}
            </Button>
          </div>
        </form>
      </SideDrawer>
    </div>
  );
};

export default TablePage;
