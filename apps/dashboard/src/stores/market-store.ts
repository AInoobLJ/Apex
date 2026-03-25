import { create } from 'zustand';
import type { MarketSummary, Pagination } from '@apex/shared';
import { api } from '../api/client';

interface MarketFilters {
  status?: string;
  category?: string;
  platform?: string;
  search?: string;
  sort?: string;
  direction?: string;
}

interface MarketStore {
  markets: MarketSummary[];
  loading: boolean;
  error: string | null;
  filters: MarketFilters;
  pagination: Pagination;
  fetchMarkets: () => Promise<void>;
  setFilters: (filters: Partial<MarketFilters>) => void;
  setPage: (page: number) => void;
}

export const useMarketStore = create<MarketStore>((set, get) => ({
  markets: [],
  loading: false,
  error: null,
  filters: {},
  pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },

  fetchMarkets: async () => {
    set({ loading: true, error: null });
    try {
      const { filters, pagination } = get();
      const response = await api.listMarkets({
        ...filters,
        page: pagination.page,
        limit: pagination.limit,
      });
      set({
        markets: response.data,
        pagination: response.pagination,
        loading: false,
      });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  setFilters: (newFilters) => {
    set((state) => ({
      filters: { ...state.filters, ...newFilters },
      pagination: { ...state.pagination, page: 1 },
    }));
    get().fetchMarkets();
  },

  setPage: (page) => {
    set((state) => ({ pagination: { ...state.pagination, page } }));
    get().fetchMarkets();
  },
}));
