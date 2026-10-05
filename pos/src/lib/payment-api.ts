import { call } from '@ury/core';

interface PaymentMode {
  mode_of_payment: string;
  opening_amount: number;
  type?: string | null;
}

interface PaymentModeResponse {
  message: PaymentMode[];
}

export const getPaymentModes = async (): Promise<string[]> => {
  // Check session storage first
  const cached = sessionStorage.getItem('payment_modes');
  if (cached) {
    return JSON.parse(cached);
  }

  try {
    const response = await call.get<PaymentModeResponse>("ury.ury_pos.api.getModeOfPayment");

    const paymentModes = response.message.map((mode:PaymentMode) => mode.mode_of_payment);
    
    // Cache in session storage
    sessionStorage.setItem('payment_modes', JSON.stringify(paymentModes));
    cacheCashModes(response.message);
    
    return paymentModes;
  } catch (error) {
    console.error('Failed to fetch payment modes:', error);
    throw error;
  }
}; 
const CASH_MODES_KEY = 'cash_payment_modes';

function cashModesOf(modes: PaymentMode[]): string[] {
  const cash = modes.filter((m) => m.type === 'Cash').map((m) => m.mode_of_payment);
  // A server that does not send the type yet: the stock "Cash" mode.
  return cash.length ? cash : modes.filter((m) => m.mode_of_payment === 'Cash').map((m) => m.mode_of_payment);
}

/** Cached only when the server named the types: a guess is retried next time. */
function cacheCashModes(modes: PaymentMode[]) {
  if (modes.some((m) => m.type)) sessionStorage.setItem(CASH_MODES_KEY, JSON.stringify(cashModesOf(modes)));
}

/** The profile's modes of type Cash: the ones that take banknotes. */
export const getCashModes = async (): Promise<string[]> => {
  try {
    const cached = sessionStorage.getItem(CASH_MODES_KEY);
    if (cached) return JSON.parse(cached);
  } catch {
    /* fall through to the server */
  }
  try {
    const response = await call.get<PaymentModeResponse>('ury.ury_pos.api.getModeOfPayment');
    cacheCashModes(response.message);
    return cashModesOf(response.message);
  } catch {
    return ['Cash'];
  }
};
