import React, { useState, useEffect } from 'react';
import { inventoryService } from '../../services/sellerService';
import { InventoryItem } from '../../types/seller';
import { useToast } from '../../context/ToastContext';
import { ErrorState } from '../../components/common/ErrorState';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';
import { formatINR } from '../../lib/currency';
import {
  Boxes,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Minus,
  Search,
  RotateCcw
} from 'lucide-react';

export const SellerInventoryPage: React.FC = () => {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempStock, setTempStock] = useState<number>(0);
  const { showToast } = useToast();

  const loadInventory = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await inventoryService.getInventory();
      setItems(data);
    } catch (err: any) {
      setError(err.message || 'Unable to load seller inventory records.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInventory();
  }, []);

  const handleStartEdit = (item: InventoryItem) => {
    setEditingId(item.id);
    setTempStock(item.availableStock);
  };

  const handleSaveStock = async (id: string) => {
    try {
      await inventoryService.updateStock(id, tempStock);
      showToast('Inventory level synchronized.');
      setEditingId(null);
      loadInventory();
    } catch (err: any) {
      showToast(err.message || 'Failed to update stock.', 'error');
    }
  };

  const filtered = items.filter(
    (i) =>
      i.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.sku.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const lowStockCount = items.filter((i) => i.isLowStock).length;

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-cream-200">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-burgundy block mb-1">
            Physical Vault Matrix
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">
            Inventory & Stock Control
          </h1>
        </div>

        {/* Low stock alert badge */}
        {lowStockCount > 0 && (
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-rosered-50 border border-rosered-200 text-rosered-700 text-xs font-semibold">
            <AlertTriangle className="w-4 h-4 text-rosered-600" />
            <span>{lowStockCount} SKU{lowStockCount === 1 ? '' : 's'} at or below threshold</span>
          </div>
        )}
      </div>

      {/* Search Filter */}
      <div className="bg-white p-4 rounded-2xl border border-cream-200 shadow-soft flex items-center gap-3">
        <Search className="w-4 h-4 text-stone-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter SKU or artifact title..."
          className="w-full text-xs text-stone-900 bg-transparent focus:outline-none"
        />
      </div>

      {error ? (
        <ErrorState message={error} onRetry={loadInventory} />
      ) : isLoading ? (
        <div className="py-20 text-center text-xs text-stone-500">
          Auditing physical stock levels...
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-cream-200 shadow-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-ivory border-b border-cream-200 text-stone-600 uppercase tracking-wider font-semibold text-[10px]">
                  <th className="py-4 px-6">Artifact Title</th>
                  <th className="py-4 px-4">SKU</th>
                  <th className="py-4 px-4">Price</th>
                  <th className="py-4 px-4">Available</th>
                  <th className="py-4 px-4">Reserved</th>
                  <th className="py-4 px-4">Sold</th>
                  <th className="py-4 px-4">Status</th>
                  <th className="py-4 px-6 text-right">Quick Stock Adjustment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cream-100">
                {filtered.map((item) => (
                  <tr
                    key={item.id}
                    className={`transition-colors ${
                      item.isLowStock ? 'bg-rosered-50/20 hover:bg-rosered-50/30' : 'hover:bg-cream-50/50'
                    }`}
                  >
                    <td className="py-4 px-6 font-serif font-semibold text-stone-900">
                      {item.productName}
                    </td>
                    <td className="py-4 px-4 font-mono text-stone-600 text-[11px]">{item.sku}</td>
                    <td className="py-4 px-4 font-bold text-stone-900">{formatINR(item.price)}</td>
                    <td className="py-4 px-4">
                      {editingId === item.id ? (
                        <div className="flex items-center gap-1.5 w-24">
                          <input
                            type="number"
                            value={tempStock}
                            onChange={(e) => setTempStock(Number(e.target.value))}
                            className="w-16 bg-white border border-stone-300 rounded p-1 text-xs"
                          />
                        </div>
                      ) : (
                        <span className="font-bold text-sm text-stone-900">
                          {item.availableStock}
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-4 text-stone-500">{item.reservedStock}</td>
                    <td className="py-4 px-4 text-emerald-700 font-semibold">{item.soldQuantity}</td>
                    <td className="py-4 px-4">
                      {item.status === 'LOW_STOCK' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-rosered-700 bg-rosered-50 border border-rosered-200 px-2 py-0.5 rounded-full">
                          <AlertTriangle className="w-3 h-3" /> Low Stock
                        </span>
                      ) : item.status === 'OUT_OF_STOCK' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-stone-500 bg-stone-100 px-2 py-0.5 rounded-full">
                          Depleted
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3 h-3" /> In Stock
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-right">
                      {editingId === item.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleSaveStock(item.id)}
                            className="px-2.5 py-1 rounded-lg bg-burgundy text-white text-xs font-semibold"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-2.5 py-1 rounded-lg text-stone-500 hover:bg-stone-100 text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleStartEdit(item)}
                        >
                          Update Count
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
