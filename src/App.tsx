/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import { useDocumentData } from 'react-firebase-hooks/firestore';
import { auth, db, signInWithGoogle, logout, OperationType, handleFirestoreError, getDocFromServer } from './firebase';
import { doc, setDoc, updateDoc, arrayUnion, increment, collection, onSnapshot, getDoc } from 'firebase/firestore';
import { Wallet, Play, History, LogOut, Coins, DollarSign, AlertCircle, CheckCircle2, Clock, X, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ChatBot } from './components/ChatBot';
import { AdminDashboard } from './components/AdminDashboard';

// --- Types ---
interface Video {
  id: string;
  title: string;
  url: string;
  duration: number; // in seconds
}

interface UserData {
  uid: string;
  coins: number;
  dailyWatchCount?: number;
  lastWatchedDate?: string;
  history: {
    videoId: string;
    earned: number;
    timestamp: string;
    title: string;
  }[];
}

// --- Constants ---
const COINS_PER_VIDEO = 5;
const COIN_TO_CASH_RATE = 0.001; // 1 coin = $0.001 (1,000 coins = $1.00)
const DAILY_LIMIT = 10;
const MIN_PAYOUT_COINS = 5000; // 5,000 coins = $5.00

// --- Components ---

const AdMobBanner = () => (
  <div className="w-full h-24 bg-zinc-900 border border-zinc-800 flex items-center justify-center rounded-lg mb-6 overflow-hidden relative group">
    <div className="absolute inset-0 bg-gradient-to-r from-orange-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
    <div className="text-center">
      <span className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1 block">Sponsored Ad</span>
      <p className="text-zinc-400 font-mono text-sm">AdMob Placeholder - High CTR Banner</p>
    </div>
    <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-zinc-800 text-[8px] text-zinc-500 rounded border border-zinc-700">AD</div>
  </div>
);

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const handleError = (e: ErrorEvent) => {
      setHasError(true);
      setErrorMsg(e.message);
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6 text-center">
        <div className="max-w-md">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Something went wrong</h2>
          <p className="text-zinc-400 mb-6 font-mono text-sm">{errorMsg}</p>
          <button onClick={() => window.location.reload()} className="px-6 py-2 bg-white text-black font-bold rounded-full hover:bg-zinc-200 transition-colors">
            Reload App
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default function App() {
  const [user, loading, error] = useAuthState(auth);
  const [userData, userLoading] = useDocumentData(user ? doc(db, 'users', user.uid) : null) as [UserData | undefined, boolean, any, any];
  const [activeVideo, setActiveVideo] = useState<Video | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isWatching, setIsWatching] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawSuccess, setWithdrawSuccess] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [bankDetails, setBankDetails] = useState({
    accountName: '',
    bankName: '',
    accountNumber: '',
    routingCode: ''
  });
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Test connection to Firestore on boot
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, []);

  // Initialize user in Firestore if not exists
  useEffect(() => {
    if (user && !userLoading && !userData) {
      const initUser = async () => {
        try {
          await setDoc(doc(db, 'users', user.uid), {
            uid: user.uid,
            coins: 0,
            dailyWatchCount: 0,
            lastWatchedDate: new Date().toISOString().split('T')[0],
            history: []
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `users/${user.uid}`);
        }
      };
      initUser();
    }
  }, [user, userData, userLoading]);

  const startWatching = (video: Video) => {
    const today = new Date().toISOString().split('T')[0];
    const dailyCount = userData?.lastWatchedDate === today ? (userData?.dailyWatchCount || 0) : 0;

    if (dailyCount >= DAILY_LIMIT) {
      setLimitReached(true);
      setTimeout(() => setLimitReached(false), 4000);
      return;
    }

    setActiveVideo(video);
    setTimeLeft(video.duration);
    setIsWatching(true);
  };

  useEffect(() => {
    if (isWatching && timeLeft > 0) {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0 && isWatching) {
      completeVideo();
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isWatching, timeLeft]);

  const completeVideo = async () => {
    if (!user || !activeVideo) return;
    setIsWatching(false);
    if (timerRef.current) clearInterval(timerRef.current);

    const today = new Date().toISOString().split('T')[0];
    const isNewDay = userData?.lastWatchedDate !== today;

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        coins: increment(COINS_PER_VIDEO),
        dailyWatchCount: isNewDay ? 1 : increment(1),
        lastWatchedDate: today,
        history: arrayUnion({
          videoId: activeVideo.id,
          title: activeVideo.title,
          earned: COINS_PER_VIDEO,
          timestamp: new Date().toISOString()
        })
      });
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
      setActiveVideo(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !userData || userData.coins < MIN_PAYOUT_COINS) return;

    try {
      const withdrawalId = doc(collection(db, 'withdrawals')).id;
      const amount = userData.coins * COIN_TO_CASH_RATE;

      await setDoc(doc(db, 'withdrawals', withdrawalId), {
        uid: user.uid,
        amount: amount,
        coins: userData.coins,
        accountName: bankDetails.accountName,
        bankName: bankDetails.bankName,
        accountNumber: bankDetails.accountNumber,
        routingCode: bankDetails.routingCode,
        status: 'pending',
        timestamp: new Date().toISOString()
      });

      await updateDoc(doc(db, 'users', user.uid), {
        coins: 0
      });

      setShowWithdrawModal(false);
      setWithdrawSuccess(true);
      setTimeout(() => setWithdrawSuccess(false), 5000);
      setBankDetails({ accountName: '', bankName: '', accountNumber: '', routingCode: '' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'withdrawals');
    }
  };

  const sampleVideos: Video[] = [
    { id: '1', title: 'Nature Relaxation', url: 'https://www.w3schools.com/html/mov_bbb.mp4', duration: 60 },
    { id: '2', title: 'Tech Trends 2026', url: 'https://www.w3schools.com/html/movie.mp4', duration: 60 },
    { id: '3', title: 'Cooking Masterclass', url: 'https://www.w3schools.com/html/mov_bbb.mp4', duration: 60 },
  ];

  if (loading) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <motion.div 
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full"
      />
    </div>
  );

  if (!user) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-md"
        >
          <div className="w-20 h-20 bg-orange-500 rounded-2xl flex items-center justify-center mx-auto mb-8 shadow-[0_0_40px_rgba(249,115,22,0.3)]">
            <Coins className="w-10 h-10 text-black" />
          </div>
          <h1 className="text-5xl font-black tracking-tighter mb-4 uppercase italic">PayVids</h1>
          <p className="text-zinc-400 mb-10 text-lg leading-relaxed">
            Turn your spare time into digital gold. Watch short clips, earn coins, and withdraw real cash.
          </p>
          <button 
            onClick={signInWithGoogle}
            className="w-full py-4 bg-white text-black font-black rounded-xl hover:bg-orange-500 hover:text-white transition-all transform hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-3 shadow-xl"
          >
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
            START EARNING NOW
          </button>
        </motion.div>
      </div>
    );
  }

  const cashValue = (userData?.coins || 0) * COIN_TO_CASH_RATE;
  const isAdmin = user?.email === 'lucihanoelem@gmail.com';

  if (showAdmin && isAdmin) {
    return <AdminDashboard onBack={() => setShowAdmin(false)} />;
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-orange-500 selection:text-black">
        {/* Header */}
        <header className="sticky top-0 z-50 bg-black/80 backdrop-blur-xl border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
              <Coins className="w-5 h-5 text-black" />
            </div>
            <span className="font-black tracking-tighter text-xl uppercase italic">PayVids</span>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button 
                onClick={() => setShowAdmin(true)}
                className="p-2 bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 rounded-full transition-colors"
                title="Admin Dashboard"
              >
                <Users className="w-5 h-5" />
              </button>
            )}
            <button onClick={logout} className="p-2 hover:bg-zinc-800 rounded-full transition-colors text-zinc-500 hover:text-white">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </header>

        <main className="max-w-2xl mx-auto p-6 pb-24">
          <AdMobBanner />

          {/* Wallet Card */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-zinc-900 rounded-3xl p-8 border border-zinc-800 mb-8 relative overflow-hidden group"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/10 blur-3xl rounded-full -mr-16 -mt-16" />
            
            <div className="flex justify-between items-start mb-8">
              <div>
                <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest mb-1">Your Balance</p>
                <div className="flex items-baseline gap-2">
                  <h2 className="text-5xl font-black tracking-tighter">{userData?.coins || 0}</h2>
                  <span className="text-orange-500 font-bold text-sm uppercase">Coins</span>
                </div>
              </div>
              <div className="bg-zinc-800 p-3 rounded-2xl border border-zinc-700">
                <Wallet className="w-6 h-6 text-zinc-400" />
              </div>
            </div>

            <div className="flex items-center gap-3 bg-black/40 p-4 rounded-2xl border border-zinc-800/50 mb-6">
              <div className="w-10 h-10 bg-green-500/20 rounded-xl flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-green-500" />
              </div>
              <div className="flex-1">
                <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">Estimated Cash</p>
                <p className="text-xl font-black tracking-tight">${cashValue.toFixed(2)}</p>
              </div>
              <button 
                onClick={() => setShowWithdrawModal(true)}
                disabled={userData?.coins ? userData.coins < MIN_PAYOUT_COINS : true}
                className={`px-4 py-2 rounded-xl font-bold text-xs transition-all ${
                  userData?.coins && userData.coins >= MIN_PAYOUT_COINS 
                    ? 'bg-green-500 text-black hover:bg-green-400' 
                    : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                }`}
              >
                WITHDRAW
              </button>
            </div>

            {userData?.coins && userData.coins < MIN_PAYOUT_COINS && (
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider text-center">
                Min. Payout: $5.00 ({MIN_PAYOUT_COINS - (userData?.coins || 0)} more coins needed)
              </p>
            )}
          </motion.div>

          {/* Daily Limit Info */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 mb-8 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-zinc-800 rounded-lg flex items-center justify-center">
                <Clock className="w-4 h-4 text-zinc-400" />
              </div>
              <div>
                <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-widest">Daily Limit</p>
                <p className="text-sm font-bold">
                  {DAILY_LIMIT - (userData?.lastWatchedDate === new Date().toISOString().split('T')[0] ? (userData?.dailyWatchCount || 0) : 0)} Videos Left
                </p>
              </div>
            </div>
            <div className="w-24 h-2 bg-zinc-800 rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${((userData?.lastWatchedDate === new Date().toISOString().split('T')[0] ? (userData?.dailyWatchCount || 0) : 0) / DAILY_LIMIT) * 100}%` }}
                className="h-full bg-orange-500"
              />
            </div>
          </div>

          {/* Instructions Section */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 mb-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-orange-500/10 rounded-xl flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-orange-500" />
              </div>
              <h3 className="text-xl font-black italic uppercase tracking-tighter">How to Use PayVids</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-900">
                <div className="text-orange-500 font-black mb-1">01. WATCH</div>
                <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-widest leading-relaxed">
                  Pick any video and watch for 60 seconds to earn 5 coins.
                </p>
              </div>
              <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-900">
                <div className="text-orange-500 font-black mb-1">02. ACCUMULATE</div>
                <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-widest leading-relaxed">
                  Watch up to 10 videos daily. 1,000 coins = $1.00 USD.
                </p>
              </div>
              <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-900">
                <div className="text-orange-500 font-black mb-1">03. WITHDRAW</div>
                <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-widest leading-relaxed">
                  Reach 5,000 coins ($5.00) to request a bank transfer.
                </p>
              </div>
            </div>
          </div>

          {/* Video List */}
          <section>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-black uppercase tracking-widest text-zinc-500">Available Tasks</h3>
              <div className="px-2 py-1 bg-orange-500/10 text-orange-500 text-[10px] font-bold rounded border border-orange-500/20">
                NEW VIDEOS ADDED
              </div>
            </div>

            <div className="space-y-4">
              {sampleVideos.map((vid) => (
                <motion.div 
                  key={vid.id}
                  whileHover={{ x: 4 }}
                  onClick={() => !isWatching && startWatching(vid)}
                  className={`flex items-center gap-4 p-4 rounded-2xl border transition-all cursor-pointer ${
                    isWatching ? 'opacity-50 grayscale pointer-events-none' : 'bg-zinc-900/50 border-zinc-800 hover:bg-zinc-900 hover:border-zinc-700'
                  }`}
                >
                  <div className="w-16 h-16 bg-zinc-800 rounded-xl flex items-center justify-center overflow-hidden relative">
                    <Play className="w-6 h-6 text-zinc-600" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-sm mb-1">{vid.title}</h4>
                    <div className="flex items-center gap-3 text-[10px] font-bold text-zinc-500 uppercase">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {vid.duration}s</span>
                      <span className="flex items-center gap-1 text-orange-500"><Coins className="w-3 h-3" /> +{COINS_PER_VIDEO}</span>
                    </div>
                  </div>
                  <div className="w-10 h-10 rounded-full border border-zinc-800 flex items-center justify-center group-hover:border-orange-500 transition-colors">
                    <Play className="w-4 h-4 text-zinc-500 group-hover:text-orange-500" />
                  </div>
                </motion.div>
              ))}
            </div>
          </section>

          {/* History */}
          <section className="mt-12">
            <h3 className="text-sm font-black uppercase tracking-widest text-zinc-500 mb-6 flex items-center gap-2">
              <History className="w-4 h-4" /> Recent Earnings
            </h3>
            <div className="space-y-3">
              {userData?.history?.slice(-5).reverse().map((item, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-zinc-900/30 rounded-xl border border-zinc-800/50">
                  <div>
                    <p className="text-xs font-bold">{item.title}</p>
                    <p className="text-[10px] text-zinc-600">{new Date(item.timestamp).toLocaleTimeString()}</p>
                  </div>
                  <div className="text-green-500 font-black text-sm">+{item.earned}</div>
                </div>
              ))}
              {(!userData?.history || userData.history.length === 0) && (
                <p className="text-center text-zinc-600 text-xs py-8 italic">No earnings yet. Start watching!</p>
              )}
            </div>
          </section>
        </main>

        {/* Video Player Overlay */}
        <AnimatePresence>
          {activeVideo && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] bg-black flex flex-col"
            >
              <div className="p-6 flex items-center justify-between border-b border-zinc-900">
                <div>
                  <h2 className="font-black tracking-tight text-xl">{activeVideo.title}</h2>
                  <p className="text-zinc-500 text-xs uppercase font-bold tracking-widest">Watching & Earning...</p>
                </div>
                <button 
                  onClick={() => {
                    setIsWatching(false);
                    setActiveVideo(null);
                    if (timerRef.current) clearInterval(timerRef.current);
                  }}
                  className="p-2 hover:bg-zinc-900 rounded-full"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 flex flex-col items-center justify-center p-6">
                <div className="w-full max-w-3xl aspect-video bg-zinc-900 rounded-3xl overflow-hidden border border-zinc-800 shadow-2xl relative">
                  <video 
                    src={activeVideo.url} 
                    autoPlay 
                    muted 
                    className="w-full h-full object-cover"
                    onEnded={completeVideo}
                  />
                  <div className="absolute inset-0 bg-black/20 pointer-events-none" />
                  
                  {/* Progress Bar */}
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-800">
                    <motion.div 
                      initial={{ width: '0%' }}
                      animate={{ width: `${((activeVideo.duration - timeLeft) / activeVideo.duration) * 100}%` }}
                      className="h-full bg-orange-500"
                    />
                  </div>
                </div>

                <div className="mt-12 text-center">
                  <div className="w-24 h-24 rounded-full border-4 border-zinc-800 flex items-center justify-center mb-4 relative">
                    <svg className="absolute inset-0 w-full h-full -rotate-90">
                      <circle 
                        cx="48" cy="48" r="44" 
                        fill="transparent" 
                        stroke="currentColor" 
                        strokeWidth="4" 
                        className="text-orange-500"
                        strokeDasharray={276}
                        strokeDashoffset={276 - (276 * (activeVideo.duration - timeLeft)) / activeVideo.duration}
                      />
                    </svg>
                    <span className="text-3xl font-black">{timeLeft}s</span>
                  </div>
                  <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs">Remaining Time</p>
                </div>
              </div>

              <div className="p-8 bg-zinc-900/50 border-t border-zinc-900 text-center">
                <div className="flex items-center justify-center gap-2 text-orange-500 font-black uppercase tracking-tighter text-lg">
                  <Coins className="w-6 h-6" /> Reward: {COINS_PER_VIDEO} Coins
                </div>
                <p className="text-zinc-500 text-[10px] mt-1 font-bold">Stay on this screen to receive your reward</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Success Toast */}
        <AnimatePresence>
          {showSuccess && (
            <motion.div 
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] bg-green-500 text-black px-6 py-4 rounded-2xl font-black flex items-center gap-3 shadow-2xl"
            >
              <CheckCircle2 className="w-6 h-6" />
              EARNED +{COINS_PER_VIDEO} COINS!
            </motion.div>
          )}
          {limitReached && (
            <motion.div 
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] bg-red-500 text-white px-6 py-4 rounded-2xl font-black flex items-center gap-3 shadow-2xl"
            >
              <AlertCircle className="w-6 h-6" />
              DAILY LIMIT REACHED!
            </motion.div>
          )}
          {withdrawSuccess && (
            <motion.div 
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] bg-blue-500 text-white px-6 py-4 rounded-2xl font-black flex items-center gap-3 shadow-2xl"
            >
              <CheckCircle2 className="w-6 h-6" />
              WITHDRAWAL REQUEST SENT!
            </motion.div>
          )}
        </AnimatePresence>

        {/* Withdrawal Modal */}
        <AnimatePresence>
          {showWithdrawModal && (
            <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowWithdrawModal(false)}
                className="absolute inset-0 bg-black/90 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl"
              >
                <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                  <h3 className="text-xl font-black italic uppercase tracking-tighter">Bank Transfer</h3>
                  <button onClick={() => setShowWithdrawModal(false)} className="p-2 hover:bg-zinc-800 rounded-full transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <form onSubmit={handleWithdraw} className="p-6 space-y-4">
                  <div className="bg-zinc-800/50 p-4 rounded-2xl border border-zinc-800 mb-4">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-zinc-500 text-[10px] uppercase font-bold tracking-widest">Amount to Withdraw</span>
                      <span className="text-orange-500 font-black tracking-tighter">${(userData?.coins || 0 * COIN_TO_CASH_RATE).toFixed(2)}</span>
                    </div>
                    <div className="text-xs text-zinc-400 font-mono">{(userData?.coins || 0).toLocaleString()} Coins</div>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-bold text-zinc-500 tracking-widest mb-1 ml-1">Account Holder Name</label>
                    <input 
                      required
                      type="text" 
                      value={bankDetails.accountName}
                      onChange={(e) => setBankDetails({...bankDetails, accountName: e.target.value})}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition-colors"
                      placeholder="e.g. John Doe"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-bold text-zinc-500 tracking-widest mb-1 ml-1">Bank Name</label>
                    <input 
                      required
                      type="text" 
                      value={bankDetails.bankName}
                      onChange={(e) => setBankDetails({...bankDetails, bankName: e.target.value})}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition-colors"
                      placeholder="e.g. Chase Bank"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-bold text-zinc-500 tracking-widest mb-1 ml-1">Account Number</label>
                    <input 
                      required
                      type="text" 
                      value={bankDetails.accountNumber}
                      onChange={(e) => setBankDetails({...bankDetails, accountNumber: e.target.value})}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition-colors"
                      placeholder="Enter account number"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-bold text-zinc-500 tracking-widest mb-1 ml-1">IFSC / Routing Code (Optional)</label>
                    <input 
                      type="text" 
                      value={bankDetails.routingCode}
                      onChange={(e) => setBankDetails({...bankDetails, routingCode: e.target.value})}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition-colors"
                      placeholder="Enter routing code"
                    />
                  </div>

                  <button 
                    type="submit"
                    className="w-full bg-orange-500 text-black font-black py-4 rounded-2xl mt-4 hover:bg-orange-400 transition-all uppercase tracking-tighter italic"
                  >
                    Confirm Withdrawal
                  </button>
                  <p className="text-[9px] text-zinc-600 text-center uppercase font-bold tracking-widest">
                    Transfers usually take 3-5 business days
                  </p>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <ChatBot />
      </div>
    </ErrorBoundary>
  );
}
