import { useEffect, useMemo } from 'react';
import { Search, SearchX, UtensilsCrossed, X } from 'lucide-react';
import { usePOSStore, type MenuItem } from '../../store/pos-store';
import { EmptyState, Skeleton, cn } from '@ury/ui';
import MenuCard from '../../components/MenuCard';
import { t } from '../../i18n';

interface CaptainMenuProps {
  /** From the per-table permission map (`get_table_order_context`). When
   * false, browsing is still allowed but tapping an item does nothing. */
  canAddItems: boolean;
  /** Opens the item's options (variants/add-ons) — the card's own button. */
  onCustomize: (item: MenuItem) => void;
}

/**
 * Touch-first menu browser for the Captain workspace. Same data, search and
 * category filter as the Cashier `MenuList` (pos-store's `menuItems` /
 * `categories` / `searchQuery` / `selectedCategory`), same `MenuCard`: a tap
 * adds one unit, the card's corner button opens its options. Search and
 * categories sit in one sticky bar so they are never more than a thumb away.
 */
const CaptainMenu: React.FC<CaptainMenuProps> = ({ canAddItems, onCustomize }) => {
  const {
    menuItems,
    menuLoading,
    selectedCategory,
    setSelectedCategory,
    searchQuery,
    setSearchQuery,
    categories,
    fetchMenuItems,
    addToOrder,
    isMenuInteractionDisabled,
    isOrderInteractionDisabled,
  } = usePOSStore();

  useEffect(() => {
    fetchMenuItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredItems = useMemo(() => {
    const term = searchQuery.toLowerCase();
    return menuItems.filter((item) => {
      const matchesCategory = !selectedCategory || item.category === selectedCategory;
      const matchesSearch =
        !searchQuery ||
        item.name.toLowerCase().includes(term) ||
        item.item.toLowerCase().includes(term);
      return matchesCategory && matchesSearch;
    });
  }, [menuItems, selectedCategory, searchQuery]);

  const disabled = !canAddItems || isMenuInteractionDisabled() || isOrderInteractionDisabled();

  const handleTap = (item: MenuItem) => {
    if (disabled) return;
    addToOrder({ ...item, quantity: 1 });
  };

  const chipClass = (active: boolean) =>
    cn(
      'shrink-0 rounded-xl border px-4 py-2 text-sm font-semibold transition-all',
      active
        ? 'border-[#f05b42] bg-[#f05b42] text-white shadow-[0_5px_14px_rgba(240,91,66,0.25)]'
        : 'border-[#eadfce] bg-white text-[#735d4e] hover:border-[#f0b83e] hover:bg-[#fff8e8]'
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2.5 border-b border-[#eadfce] bg-[#fffdf8] px-3 py-3 sm:px-4">
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9a7e6b]" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('captain.search_menu')}
            inputMode="search"
            className="h-11 w-full rounded-xl border border-[#eadfce] bg-white pe-9 ps-9 text-base text-[#3f2a20] placeholder:text-[#b29a88] focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label={t('common.clear')}
              className="absolute end-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-[#9a7e6b] hover:bg-[#f5eadc]"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-0.5 sm:-mx-4 sm:px-4">
          <button type="button" onClick={() => setSelectedCategory('')} className={chipClass(selectedCategory === '')}>
            {t('common.all')}
          </button>
          {categories.map((category) => (
            <button
              key={category.name}
              type="button"
              onClick={() => setSelectedCategory(category.name)}
              className={chipClass(selectedCategory === category.name)}
            >
              {category.label}
            </button>
          ))}
        </div>

        {!canAddItems && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {t('captain.browse_only')}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
        {menuLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" aria-busy="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} shape="block" className="h-60" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <EmptyState
            className="h-80"
            icon={searchQuery || selectedCategory ? <SearchX /> : <UtensilsCrossed />}
            title={t('captain.no_items_found')}
            description={t('common.try_adjusting_filters')}
          />
        ) : (
          <div
            className={cn(
              'grid grid-cols-2 gap-3 pb-6 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5',
              disabled && canAddItems && 'pointer-events-none opacity-60'
            )}
          >
            {filteredItems.map((item, index) => (
              <MenuCard
                key={item.id}
                index={index}
                id={item.id}
                name={item.name}
                price={item.price}
                item_image={item.image}
                category={item.category_label || item.category}
                item={item.item}
                onClick={() => handleTap(item)}
                onCustomize={canAddItems ? () => onCustomize(item) : undefined}
                disabled={disabled}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CaptainMenu;
