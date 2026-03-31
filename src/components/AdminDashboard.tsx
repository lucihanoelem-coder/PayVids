import React, { useState } from 'react';
import { db, OperationType, handleFirestoreError } from '../firebase';
import { collection, query, orderBy, updateDoc, doc } from 'firebase/firestore';
import { useCollection, useCollectionData } from 'react-firebase-hooks/firestore';
import { Users, CreditCard, CheckCircle2, XCircle, Clock, ArrowLeft, Search, DollarSign } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Withdrawal {
  id: string;
  uid: string;
  amount: number;
  coins: number;
  accountName: string;
  bankName: string;
  accountNumber: string;
  routingCode?: string;
  status: 'pending' | 'completed' | 'rejected';
  timestamp: string;
}

interface UserData {
  uid: string;
  coins: number;
  dailyWatchCount: number;
  lastWatchedDate: string;
}

export const AdminDashboard: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [withdrawalsSnap, loadingWithdrawals] = useCollection(
    query(collection(db, 'withdrawals'), orderBy('timestamp', 'desc'))
  );

  const withdrawals = withdrawalsSnap?.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  })) as Withdrawal[] | undefined;

  const [users, loadingUsers] = useCollectionData(
    collection(db, 'users')
  ) as [UserData[] | undefined, boolean, any, any];

  const [searchTerm, setSearchTerm] = useState('');

  const updateStatus = async (id: string, status: 'completed' | 'rejected') => {
    try {
      await updateDoc(doc(db, 'withdrawals', id), { status });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `withdrawals/${id}`);
    }
  };

  const stats = {
    totalUsers: users?.length || 0,
    totalCoins: users?.reduce((acc, u) => acc + (u.coins || 0), 0) || 0,
    pendingWithdrawals: withdrawals?.filter(w => w.status === 'pending').length || 0,
    totalPaid: withdrawals?.filter(w => w.status === 'completed').reduce((acc, w) => acc + w.amount, 0) || 0
  };

  const filteredWithdrawals = withdrawals?.filter(w => 
    w.accountName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    w.uid.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-6xl mx-auto">
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="p-2 hover:bg-zinc-900 rounded-full transition-colors">
              <ArrowLeft className="w-6 h-6" />
            </button>
            <h1 className="text-3xl font-black italic uppercase tracking-tighter">Admin Control</h1>
          </div>
          <div className="bg-orange-500 text-black px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">
            Live Monitoring
          </div>
        </header>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl">
            <Users className="w-6 h-6 text-blue-500 mb-2" />
            <div className="text-2xl font-black">{stats.totalUsers}</div>
            <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Total Users</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl">
            <CreditCard className="w-6 h-6 text-orange-500 mb-2" />
            <div className="text-2xl font-black">{stats.totalCoins.toLocaleString()}</div>
            <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Coins in Circulation</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl">
            <Clock className="w-6 h-6 text-yellow-500 mb-2" />
            <div className="text-2xl font-black">{stats.pendingWithdrawals}</div>
            <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Pending Payouts</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl">
            <DollarSign className="w-6 h-6 text-green-500 mb-2" />
            <div className="text-2xl font-black">${stats.totalPaid.toFixed(2)}</div>
            <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Total Paid Out</div>
          </div>
        </div>

        {/* Withdrawals Table */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden">
          <div className="p-6 border-b border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h2 className="text-xl font-black italic uppercase tracking-tighter">Withdrawal Requests</h2>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input 
                type="text"
                placeholder="Search by name or UID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2 text-xs focus:outline-none focus:border-orange-500 w-full md:w-64"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest border-b border-zinc-800">
                  <th className="p-6">User / Date</th>
                  <th className="p-6">Bank Details</th>
                  <th className="p-6">Amount</th>
                  <th className="p-6">Status</th>
                  <th className="p-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {filteredWithdrawals?.map((w) => (
                  <tr key={w.id} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="p-6">
                      <div className="font-bold text-sm">{w.accountName}</div>
                      <div className="text-[10px] text-zinc-500 font-mono">{w.uid.slice(0, 8)}...</div>
                      <div className="text-[10px] text-zinc-600 mt-1">{new Date(w.timestamp).toLocaleDateString()}</div>
                    </td>
                    <td className="p-6">
                      <div className="text-xs font-bold">{w.bankName}</div>
                      <div className="text-[10px] text-zinc-500 font-mono">{w.accountNumber}</div>
                      {w.routingCode && <div className="text-[10px] text-zinc-600">IFSC: {w.routingCode}</div>}
                    </td>
                    <td className="p-6">
                      <div className="text-orange-500 font-black">${w.amount.toFixed(2)}</div>
                      <div className="text-[10px] text-zinc-500">{w.coins.toLocaleString()} Coins</div>
                    </td>
                    <td className="p-6">
                      <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded ${
                        w.status === 'pending' ? 'bg-yellow-500/10 text-yellow-500' :
                        w.status === 'completed' ? 'bg-green-500/10 text-green-500' :
                        'bg-red-500/10 text-red-500'
                      }`}>
                        {w.status}
                      </span>
                    </td>
                    <td className="p-6 text-right">
                      {w.status === 'pending' && (
                        <div className="flex items-center justify-end gap-2">
                          <button 
                            onClick={() => updateStatus(w.id, 'completed')}
                            className="p-2 hover:bg-green-500/20 text-green-500 rounded-lg transition-colors"
                            title="Mark as Paid"
                          >
                            <CheckCircle2 className="w-5 h-5" />
                          </button>
                          <button 
                            onClick={() => updateStatus(w.id, 'rejected')}
                            className="p-2 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors"
                            title="Reject"
                          >
                            <XCircle className="w-5 h-5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(!filteredWithdrawals || filteredWithdrawals.length === 0) && (
              <div className="p-12 text-center text-zinc-500 text-sm italic">
                No withdrawal requests found.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
