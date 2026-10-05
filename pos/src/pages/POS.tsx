import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { LayoutGrid, PanelRightClose, PanelRightOpen, Pin, ShoppingBasket, Star, TrendingUp, Zap } from 'lucide-react';
import { formatCurrency } from '@ury/core';
import Sidebar from '../components/Sidebar';
import OrderPanel from '../components/OrderPanel';
import OrderSummaryBar from '../components/OrderSummaryBar';
import { useOrderTotal } from '../hooks/useOrderTotal';
import SlideOverPanel from '../components/SlideOverPanel';
import { useDockedPanels } from '../hooks/useViewport';
import ProductDialog from '../components/ProductDialog';
import MenuList from '../components/MenuList';
import { usePOSStore, type MenuItem } from '../store/pos-store';
import { cn, ErrorState } from '@ury/ui';
import { Spinner } from '@ury/ui';
import InitialLoader from '../components/InitialLoader';
import LiveOrderSync from '../components/LiveOrderSync';

const ORDER_PANEL_KEY = 'ury_pos_order_panel';

/** Per-device convenience: storage can be blocked, and that is fine. */
function readOrderDocked(): boolean {
  try {
    return localStorage.getItem(ORDER_PANEL_KEY) === 'docked';
  } catch {
    return false;
  }
}

export default function POS() {
  const {
    quickFilter,
    setQuickFilter,
    setSelectedItem,
    addToOrder,
    loading,
    error,
    isMenuInteractionDisabled,
    isInitializing,
    initializeApp,
  } = usePOSStore();
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  /**
   * Below 1024px the categories rail and the order panel are sheets rather
   * than columns (UX-06). Both are closed when the layout goes back to
   * docked, so resizing or rotating a tablet never leaves a stranded overlay
   * on top of panels that are now visible anyway.
   */
  const docked = useDockedPanels();
  const [showCategories, setShowCategories] = useState(false);
  const [showOrder, setShowOrder] = useState(false);

  /**
   * On a wide screen the order can sit beside the menu or wait behind a
   * button. A docked panel squeezes the menu into what is left of the
   * screen, so by default the menu gets the whole width and the order slides
   * in from the trailing edge when asked for — wider than the docked column,
   * so its lines are readable, and fully editable. Pinning it back is one
   * tap, remembered per device.
   */
  const [orderDocked, setOrderDockedState] = useState<boolean>(readOrderDocked);
  const setOrderDocked = (next: boolean) => {
    setOrderDockedState(next);
    setShowOrder(false);
    try {
      localStorage.setItem(ORDER_PANEL_KEY, next ? 'docked' : 'sheet');
    } catch {
      /* blocked storage: the choice still holds for this visit */
    }
  };
  const orderInSheet = !docked || !orderDocked;
  const { count: orderCount, total: orderTotal } = useOrderTotal();

  useEffect(() => {
    if (docked) {
      setShowCategories(false);
      setShowOrder(false);
    }
  }, [docked]);

  /**
   * Adds the item straight away.
   *
   * This used to count clicks against a 250ms timer to tell a single click
   * (add) from a double click (customise). The counter and the timer were
   * module-level refs shared by every card, so two quick taps on two
   * *different* items read as one double click: the dialog opened for
   * whichever item was tapped second, and neither was added. A cashier
   * working at speed hit this constantly, and the faster they worked the
   * worse it got.
   *
   * Customising is now its own button on the card, so adding needs no
   * disambiguation window and a tap is answered immediately.
   */
  const handleItemClick = (item: MenuItem) => {
    if (isMenuInteractionDisabled()) return;
    addToOrder({ ...item, quantity: 1 });
  };

  const handleItemCustomize = (item: MenuItem) => {
    if (isMenuInteractionDisabled()) return;
    setSelectedItem(item);
    setIsDialogOpen(true);
  };

  const QuickFilterButton = ({ filter, icon: Icon, label }: { 
    filter: 'all' | 'special';
    icon: React.ElementType;
    label: string;
  }) => (
    <button
      onClick={() => setQuickFilter(filter)}
      className={cn(
        'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all',
        quickFilter === filter
          ? 'bg-[#f05b42] text-white shadow-[0_5px_14px_rgba(240,91,66,0.25)]'
          : 'bg-white text-[#735d4e] border border-[#eadfce] hover:border-[#f0b83e] hover:bg-[#fff8e8]',
        isMenuInteractionDisabled() && 'opacity-50 cursor-not-allowed pointer-events-none'
      )}
      disabled={isMenuInteractionDisabled()}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );

  if (isInitializing) {
    return <InitialLoader />;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <ErrorState
          title={t('pos_page.failed_load')}
          description={error}
          retryLabel={t('common.retry')}
          // Re-runs the failed request rather than reloading the app, which
          // would discard the open order tabs along with the error.
          onRetry={() => initializeApp()}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner message={t('common.loading_menu_items')} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-red-600">{t('common.error_loading_menu_items')}</p>
          <p className="text-sm text-gray-500 mt-2">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden bg-[#f8f4eb]">
      <LiveOrderSync />
      {docked && <Sidebar disabled={isMenuInteractionDisabled()} />}
      <div
        className={cn(
          'flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden'
        )}
      >
        <div className="px-5 py-4 bg-[#fffdf8] border-b border-[#eadfce]">
          <div className="max-w-screen-xl mx-auto space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">{t('pos_page.service_counter')}</p>
                <h1 className="text-xl font-bold tracking-tight text-[#3f2a20]">{t('pos_page.build_an_order')}</h1>
              </div>
              <div className="flex items-center gap-2">
                <div className="hidden lg:flex items-center gap-2 rounded-xl bg-[#fff2d7] px-3 py-2 text-xs font-medium text-[#8f6b55]">
                  <Zap className="w-3.5 h-3.5 text-[#d89917]" />{t('pos_page.tap_item_hint')}</div>
                {docked && orderInSheet && (
                  <button
                    type="button"
                    onClick={() => setShowOrder(true)}
                    aria-haspopup="dialog"
                    aria-expanded={showOrder}
                    className="flex items-center gap-3 rounded-xl bg-[#f05b42] px-4 py-2 text-white shadow-[0_5px_14px_rgba(240,91,66,0.25)] transition-colors hover:bg-[#e04a31] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <span className="relative">
                      <ShoppingBasket className="h-5 w-5" />
                      {orderCount > 0 && (
                        <span className="absolute -end-2.5 -top-2.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-white px-1 text-[11px] font-bold tabular-nums text-[#f05b42]">
                          {orderCount}
                        </span>
                      )}
                    </span>
                    <span className="flex flex-col items-start leading-tight">
                      <span className="text-xs font-semibold opacity-90">{t('pos_page.show_order')}</span>
                      <span className="text-sm font-bold tabular-nums">{formatCurrency(orderTotal)}</span>
                    </span>
                    <PanelRightOpen className="h-4 w-4 opacity-80 rtl:-scale-x-100" />
                  </button>
                )}
                {docked && !orderInSheet && (
                  <button
                    type="button"
                    onClick={() => setOrderDocked(false)}
                    title={t('pos_page.hide_order')}
                    className="flex items-center gap-2 rounded-xl border border-[#eadfce] bg-white px-3 py-2 text-sm font-semibold text-[#735d4e] transition-colors hover:border-[#f0b83e] hover:bg-[#fff8e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <PanelRightClose className="h-4 w-4 text-primary rtl:-scale-x-100" />
                    {t('pos_page.hide_order')}
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto overflow-y-hidden">
              {!docked && (
                <button
                  type="button"
                  onClick={() => setShowCategories(true)}
                  disabled={isMenuInteractionDisabled()}
                  className={cn(
                    'flex items-center gap-2 rounded-xl border border-[#eadfce] bg-white px-4 py-2 text-sm font-semibold text-[#735d4e] transition-all hover:border-[#f0b83e] hover:bg-[#fff8e8]',
                    isMenuInteractionDisabled() && 'opacity-50 cursor-not-allowed pointer-events-none'
                  )}
                >
                  <LayoutGrid className="w-4 h-4 text-primary" />
                  {t('pos_sidebar.categories')}
                </button>
              )}
              {/* <SearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                onVisibilityChange={setShowSearch}
                isVisible={showSearch}
                disabled={isMenuInteractionDisabled()}
              /> */}
              
              <QuickFilterButton filter="all" icon={Star} label={t('common.all')} />
              <QuickFilterButton filter="special" icon={TrendingUp} label={t('menu.special_items')} />
            </div>
          </div>
        </div>

        <MenuList onItemClick={handleItemClick} onItemCustomize={handleItemCustomize} />

        {!docked && <OrderSummaryBar onOpen={() => setShowOrder(true)} />}
      </div>

      {docked && !orderInSheet && <OrderPanel />}

      {docked && orderInSheet && (
        <SlideOverPanel
          isOpen={showOrder}
          onClose={() => setShowOrder(false)}
          title={t('order_panel.your_order')}
          className="max-w-xl"
          actions={
            <button
              type="button"
              onClick={() => setOrderDocked(true)}
              title={t('pos_page.pin_order')}
              aria-label={t('pos_page.pin_order')}
              className="flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-[#8f6b55] transition-colors hover:bg-[#fff0cb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Pin className="h-4 w-4" />
              <span className="hidden sm:inline">{t('pos_page.pin_order')}</span>
            </button>
          }
        >
          <OrderPanel docked={false} />
        </SlideOverPanel>
      )}

      {!docked && (
        <>
          <SlideOverPanel
            isOpen={showCategories}
            onClose={() => setShowCategories(false)}
            title={t('pos_sidebar.categories')}
            side="start"
            className="max-w-xs"
          >
            <Sidebar
              disabled={isMenuInteractionDisabled()}
              onCategorySelect={() => setShowCategories(false)}
              className="w-full border-e-0"
            />
          </SlideOverPanel>

          <SlideOverPanel
            isOpen={showOrder}
            onClose={() => setShowOrder(false)}
            title={t('order_panel.your_order')}
            className="max-w-lg"
          >
            <OrderPanel docked={false} />
          </SlideOverPanel>
        </>
      )}

      {isDialogOpen && <ProductDialog onClose={() => setIsDialogOpen(false)} />}
    </div>
  );
}
