import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { DollarSign, BarChart2, ArrowLeft, Plus, Sparkles } from 'lucide-react';

// --- Supabase Configuration ---
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

// Check if Supabase is configured
const isConfigured = supabaseUrl && supabaseAnonKey;
let supabase;
if (isConfigured) {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
}

// --- Gemini API Helper (No changes needed) ---
const callGemini = async (prompt) => {
    // IMPORTANT: In a real production app, never expose your API key on the client-side.
    // This call should be moved to a secure backend or a Supabase Edge Function.
    const apiKey = ""; // You still need a way to provide this
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, topK: 1, topP: 1, maxOutputTokens: 200 } };
    try {
        const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!response.ok) throw new Error(`API request failed with status ${response.status}`);
        const result = await response.json();
        if (result.candidates && result.candidates[0].content && result.candidates[0].content.parts[0]) {
            return result.candidates[0].content.parts[0].text;
        }
        return "Sorry, I couldn't generate a response right now.";
    } catch (error) {
        console.error('Error calling Gemini API:', error);
        return "There was an issue connecting to the AI service.";
    }
};

// --- Helper Functions (No changes needed) ---
const isToday = (someDate) => {
    const today = new Date();
    const d = new Date(someDate);
    return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
};
const getStartOfWeek = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff)).toISOString().split('T')[0];
};

// --- Main App Component ---
export default function App() {
    const [view, setView] = useState('logger'); // 'logger' or 'stats'
    const [tips, setTips] = useState([]);
    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    // --- Authentication & Data Fetching Effect ---
    useEffect(() => {
        if (!isConfigured) {
            setError("Supabase is not configured. Add your URL and Anon Key to a .env file.");
            setIsLoading(false);
            return;
        }

        const fetchTips = async (userId) => {
            const { data, error } = await supabase
                .from('tips')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });

            if (error) {
                console.error("Error fetching tips:", error);
                setError("Failed to load tips. Check your connection and RLS policies.");
            } else {
                // Map Supabase columns to original app structure
                const formattedTips = data.map(tip => ({
                    id: tip.id,
                    amount: tip.amount,
                    timestamp: tip.created_at // Use the correct column name
                }));
                setTips(formattedTips);
            }
            setIsLoading(false);
        };

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            const currentUser = session?.user;
            setUser(currentUser ?? null);

            if (!currentUser) {
                supabase.auth.signInAnonymously();
            } else {
                fetchTips(currentUser.id);
            }
        });
        
        const tipsSubscription = supabase.channel('public:tips')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tips' }, (payload) => {
                if (user) {
                   fetchTips(user.id);
                }
            })
            .subscribe();

        return () => {
            subscription?.unsubscribe();
            supabase.removeChannel(tipsSubscription);
        };
    }, []); // <-- THE ONLY CHANGE IS HERE: from [user] to []

    // --- Render Logic ---
    if (!isConfigured) {
        return <ErrorScreen message="Supabase is not configured. Add your URL and Anon Key to a .env file." />
    }
    if (isLoading) return <LoadingScreen />;
    if (error) return <ErrorScreen message={error} />

    return (
        <div className="bg-slate-900 text-white min-h-screen font-sans">
            <div className="container mx-auto p-4 max-w-4xl">
                 <Header userId={user?.id} />
                {view === 'logger' && <TipLogger tips={tips} user={user} setView={setView} />}
                {view === 'stats' && <StatsDashboard tips={tips} setView={setView} />}
            </div>
        </div>
    );
}

// --- Tip Logger View (Modified for Supabase) ---
const TipLogger = ({ tips, user, setView }) => {
    const [amount, setAmount] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [pepTalk, setPepTalk] = useState('');
    const [isGeneratingPepTalk, setIsGeneratingPepTalk] = useState(false);

    const todayTips = useMemo(() => tips.filter(tip => isToday(tip.timestamp)), [tips]);
    const todayTotal = useMemo(() => todayTips.reduce((sum, tip) => sum + tip.amount, 0), [todayTips]);
    const todayAverage = useMemo(() => (todayTips.length > 0 ? todayTotal / todayTips.length : 0), [todayTotal, todayTips.length]);

    const handleAddTip = async (e) => {
        e.preventDefault();
        const tipAmount = parseFloat(amount);
        if (!tipAmount || tipAmount <= 0 || !user) return;

        setIsAdding(true);
        try {
            const { error } = await supabase
                .from('tips')
                .insert([{ amount: tipAmount, user_id: user.id }]);

            if (error) {
                throw error;
            }
            setAmount('');
        } catch (error) {
            console.error("Error adding tip: ", error);
            alert("Error adding tip: " + error.message);
        } finally {
            setIsAdding(false);
        }
    };

    const handleGetPepTalk = async () => {
        setIsGeneratingPepTalk(true);
        setPepTalk('');
        const prompt = `I'm a ride-share driver. So far today, I've made ${todayTips.length} tips totaling $${todayTotal.toFixed(2)}. Write a very short, encouraging, and motivational pep talk for me (2-3 sentences). Be friendly and positive.`;
        const response = await callGemini(prompt);
        setPepTalk(response);
        setIsGeneratingPepTalk(false);
    };

    return (
         <div>
            <form onSubmit={handleAddTip} className="bg-slate-800 p-4 rounded-lg shadow-lg mb-6">
                <div className="flex flex-col sm:flex-row gap-4">
                    <div className="relative flex-grow">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                        <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Enter tip amount" className="w-full bg-slate-700 text-white placeholder-slate-400 rounded-md py-3 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-emerald-500" required />
                    </div>
                    <button type="submit" disabled={isAdding} className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-md transition-colors duration-300 disabled:bg-slate-600 disabled:cursor-not-allowed">
                        <Plus size={20} /> {isAdding ? 'Logging...' : 'Log Tip'}
                    </button>
                </div>
            </form>
            <div className="bg-slate-800 p-4 rounded-lg shadow-lg mb-6 text-center">
                <h3 className="text-lg font-bold text-violet-400 mb-2">Need a boost?</h3>
                <button onClick={handleGetPepTalk} disabled={isGeneratingPepTalk || todayTips.length === 0} className="flex items-center justify-center gap-2 mx-auto bg-violet-600 hover:bg-violet-700 text-white font-bold py-2 px-5 rounded-md transition-colors duration-300 disabled:bg-slate-600 disabled:cursor-not-allowed">
                    <Sparkles size={20} /> {isGeneratingPepTalk ? 'Thinking...' : '✨ Get Daily Pep Talk'}
                </button>
                {isGeneratingPepTalk && <div className="text-slate-400 mt-3">Generating your pep talk...</div>}
                {pepTalk && <div className="mt-4 p-3 bg-slate-700/50 rounded-lg text-left"><p className="text-slate-300 italic">{pepTalk}</p></div>}
                {todayTips.length === 0 && <p className="text-xs text-slate-500 mt-2">Log at least one tip to get a pep talk.</p>}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-slate-800 p-4 rounded-lg text-center"><h3 className="text-slate-400 text-sm">Today's Total</h3><p className="text-3xl font-bold text-emerald-400">${todayTotal.toFixed(2)}</p></div>
                <div className="bg-slate-800 p-4 rounded-lg text-center"><h3 className="text-slate-400 text-sm">Tips Today</h3><p className="text-3xl font-bold">{todayTips.length}</p></div>
                <div className="bg-slate-800 p-4 rounded-lg text-center"><h3 className="text-slate-400 text-sm">Average Tip</h3><p className="text-3xl font-bold">${todayAverage.toFixed(2)}</p></div>
            </div>
            <div className="text-center mb-6">
                <button onClick={() => setView('stats')} className="flex items-center justify-center gap-2 w-full sm:w-auto mx-auto bg-sky-600 hover:bg-sky-700 text-white font-bold py-3 px-6 rounded-md transition-colors duration-300">
                    <BarChart2 size={20} /> View Statistics
                </button>
            </div>
            <div className="bg-slate-800 p-4 rounded-lg">
                <h2 className="text-xl font-bold mb-4">Today's Logged Tips</h2>
                {todayTips.length > 0 ? (
                    <ul className="space-y-3 max-h-60 overflow-y-auto pr-2">
                        {todayTips.map(tip => (
                            <li key={tip.id} className="flex justify-between items-center bg-slate-700 p-3 rounded-md">
                                <span className="font-semibold text-emerald-400">${tip.amount.toFixed(2)}</span>
                                <span className="text-slate-400 text-sm">{new Date(tip.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </li>
                        ))}
                    </ul>
                ) : (<p className="text-slate-400 text-center py-4">No tips logged for today yet.</p>)}
            </div>
        </div>
    );
};

// --- Other components (Header, LoadingScreen, ErrorScreen, StatsDashboard, etc.) ---
// --- No changes are needed for these components. You can copy them from your original file. ---

const Header = ({ userId }) => (
    <header className="mb-6">
        <h1 className="text-4xl font-bold text-emerald-400 text-center">Tip Tracker</h1>
        <p className="text-center text-slate-400 mt-2">Log your tips and track your earnings with AI insights.</p>
        {userId && <p className="text-center text-xs text-slate-500 mt-2 break-all">User ID: {userId}</p>}
    </header>
);

const LoadingScreen = () => (
    <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="text-center">
            <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-emerald-500 mx-auto"></div>
            <p className="text-white text-xl mt-4">Loading Your Tips...</p>
        </div>
    </div>
);

const ErrorScreen = ({ message }) => (
     <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="text-center p-8 bg-slate-800 rounded-lg shadow-lg">
            <h2 className="text-red-500 text-2xl font-bold mb-4">An Error Occurred</h2>
            <p className="text-white">{message}</p>
        </div>
    </div>
);

const StatsDashboard = ({ tips, setView }) => {
    const [insights, setInsights] = useState('');
    const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);

    const statsData = useMemo(() => {
        if (tips.length === 0) return { byDay: [], byHour: [], byWeek: [], allTimeTotal: 0, allTimeAverage: 0, bestTip: 0 };
        const byDay = Array(7).fill(0).map(() => ({ total: 0, count: 0 }));
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const byHour = Array(24).fill(0).map(() => ({ total: 0, count: 0 }));
        const byWeek = {};
        let allTimeTotal = 0, bestTip = 0;
        tips.forEach(tip => {
            const date = new Date(tip.timestamp);
            const dayIndex = date.getDay(), hour = date.getHours(), weekStart = getStartOfWeek(date);
            byDay[dayIndex].total += tip.amount; byDay[dayIndex].count++;
            byHour[hour].total += tip.amount; byHour[hour].count++;
            if (!byWeek[weekStart]) byWeek[weekStart] = { total: 0, count: 0 };
            byWeek[weekStart].total += tip.amount; byWeek[weekStart].count++;
            allTimeTotal += tip.amount;
            if (tip.amount > bestTip) bestTip = tip.amount;
        });
        const formattedByDay = byDay.map((d, i) => ({ name: dayNames[i], Total: parseFloat(d.total.toFixed(2)) }));
        const formattedByHour = byHour.map((d, i) => ({ name: `${i}:00`, Total: parseFloat(d.total.toFixed(2)) }));
        const formattedByWeek = Object.keys(byWeek).sort().map(w => ({ name: w, Total: parseFloat(byWeek[w].total.toFixed(2)) }));
        const allTimeAverage = tips.length > 0 ? allTimeTotal / tips.length : 0;
        return { byDay: formattedByDay, byHour: formattedByHour, byWeek: formattedByWeek, allTimeTotal, allTimeAverage, bestTip };
    }, [tips]);

    const handleGetInsights = async () => {
        setIsGeneratingInsights(true); setInsights('');
        const latestWeekData = statsData.byWeek.length > 0 ? statsData.byWeek[statsData.byWeek.length - 1] : null;
        if (!latestWeekData) { setInsights("Not enough data for weekly insight."); setIsGeneratingInsights(false); return; }
        const prompt = `Act as a friendly performance coach for a ride-share driver. Analyze their tips from last week and provide a short (3-4 sentences) analysis. Highlight one positive trend and offer one actionable suggestion. Data: - Week starting: ${latestWeekData.name} - Total weekly tips: $${latestWeekData.Total.toFixed(2)} - Tips by day: ${JSON.stringify(statsData.byDay)} - Tips by hour: ${JSON.stringify(statsData.byHour.filter(h => h.Total > 0))}`;
        const response = await callGemini(prompt);
        setInsights(response); setIsGeneratingInsights(false);
    };

    if (tips.length === 0) {
        return (
             <div className="text-center">
                <button onClick={() => setView('logger')} className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-2 px-4 rounded-md transition-colors mb-4"><ArrowLeft size={20} /> Back to Logger</button>
                <div className="bg-slate-800 p-8 rounded-lg"><h2 className="text-2xl font-bold mb-2">No Statistics Yet</h2><p className="text-slate-400">Start logging tips to see your stats here!</p></div>
            </div>
        )
    }

    return (
        <div>
            <button onClick={() => setView('logger')} className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-2 px-4 rounded-md transition-colors mb-6"><ArrowLeft size={20} /> Back to Logger</button>
            <div className="bg-slate-800 p-4 rounded-lg shadow-lg mb-8 text-center">
                <h3 className="text-xl font-bold text-violet-400 mb-2">AI Performance Review</h3>
                 <button onClick={handleGetInsights} disabled={isGeneratingInsights || statsData.byWeek.length === 0} className="flex items-center justify-center gap-2 mx-auto bg-violet-600 hover:bg-violet-700 text-white font-bold py-2 px-5 rounded-md transition-colors duration-300 disabled:bg-slate-600 disabled:cursor-not-allowed">
                    <Sparkles size={20} /> {isGeneratingInsights ? 'Analyzing...' : '✨ Get Weekly Insights'}
                </button>
                {isGeneratingInsights && <div className="text-slate-400 mt-3">Analyzing your performance...</div>}
                {insights && <div className="mt-4 p-4 bg-slate-700/50 rounded-lg text-left"><p className="text-slate-300 whitespace-pre-wrap">{insights}</p></div>}
                {statsData.byWeek.length === 0 && <p className="text-xs text-slate-500 mt-2">Log tips for at least a week to get insights.</p>}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                <div className="bg-slate-800 p-4 rounded-lg text-center"><h3 className="text-slate-400 text-sm">All-Time Total</h3><p className="text-3xl font-bold text-emerald-400">${statsData.allTimeTotal.toFixed(2)}</p></div>
                <div className="bg-slate-800 p-4 rounded-lg text-center"><h3 className="text-slate-400 text-sm">All-Time Average</h3><p className="text-3xl font-bold">${statsData.allTimeAverage.toFixed(2)}</p></div>
                <div className="bg-slate-800 p-4 rounded-lg text-center"><h3 className="text-slate-400 text-sm">Best Tip Ever</h3><p className="text-3xl font-bold">${statsData.bestTip.toFixed(2)}</p></div>
            </div>
            <div className="space-y-8">
                <ChartCard title="Tips by Day of Week"><ResponsiveContainer width="100%" height={300}><BarChart data={statsData.byDay}><CartesianGrid strokeDasharray="3 3" stroke="#475569" /><XAxis dataKey="name" stroke="#94a3b8" /><YAxis stroke="#94a3b8" tickFormatter={(v) => `$${v}`} /><Tooltip content={<CustomTooltip />} /><Legend /><Bar dataKey="Total" fill="#34d399" /></BarChart></ResponsiveContainer></ChartCard>
                <ChartCard title="Tips by Hour of Day"><ResponsiveContainer width="100%" height={300}><BarChart data={statsData.byHour}><CartesianGrid strokeDasharray="3 3" stroke="#475569" /><XAxis dataKey="name" stroke="#94a3b8" interval={2} /><YAxis stroke="#94a3b8" tickFormatter={(v) => `$${v}`} /><Tooltip content={<CustomTooltip />} /><Legend /><Bar dataKey="Total" fill="#38bdf8" /></BarChart></ResponsiveContainer></ChartCard>
                <ChartCard title="Weekly Tip Totals"><ResponsiveContainer width="100%" height={300}><LineChart data={statsData.byWeek}><CartesianGrid strokeDasharray="3 3" stroke="#475569" /><XAxis dataKey="name" stroke="#94a3b8" /><YAxis stroke="#94a3b8" tickFormatter={(v) => `$${v}`} /><Tooltip content={<CustomTooltip />} /><Legend /><Line type="monotone" dataKey="Total" stroke="#a78bfa" strokeWidth={2} /></LineChart></ResponsiveContainer></ChartCard>
            </div>
        </div>
    );
};

const ChartCard = ({ title, children }) => (<div className="bg-slate-800 p-4 rounded-lg shadow-lg"><h3 className="text-xl font-bold mb-4 text-center">{title}</h3>{children}</div>);
const CustomTooltip = ({ active, payload, label }) => { if (active && payload && payload.length) { return (<div className="bg-slate-700 p-3 rounded-md border border-slate-600"><p className="label text-white font-bold">{`${label}`}</p><p className="intro text-emerald-400">{`Total : $${payload[0].value.toFixed(2)}`}</p></div>); } return null; };