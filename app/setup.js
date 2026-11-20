const fs = require('fs');
const path = require('path');

const files = {
  '.env.local': `NEXT_PUBLIC_SUPABASE_URL=paste_your_supabase_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=paste_your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=paste_your_supabase_service_role_key_here
PAYSTACK_SECRET_KEY=paste_your_paystack_secret_key_here
NEXT_PUBLIC_SITE_URL=http://localhost:3000
`,

  'lib/supabase.js': `import { createClient } from '@supabase/supabase-js';
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
`,

  'lib/supabaseAdmin.js': `import { createClient } from '@supabase/supabase-js';
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
`,

  'components/Logo.jsx': `export default function Logo() {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <svg width="38" height="38" viewBox="0 0 40 40" fill="none">
        <rect x="6" y="6" width="28" height="28" rx="6" transform="rotate(-12 20 20)" fill="#2563EB" />
        <rect x="15" y="15" width="10" height="10" rx="2" transform="rotate(-12 20 20)" fill="#FFFFFF" />
      </svg>
      <span className="text-2xl font-black tracking-tight text-white">
        BLOX<span className="text-blue-500">HUB</span>
      </span>
    </div>
  );
}
`,

  'app/api/admin/update-user/route.js': `import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req) {
  try {
    const { adminId, targetUserId, coin_balance, coin_unit_price_ngn } = await req.json();
    const { data: adminProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', adminId)
      .single();

    if (!adminProfile || adminProfile.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { error } = await supabaseAdmin
      .from('profiles')
      .update({
        coin_balance: Number(coin_balance),
        coin_unit_price_ngn: Number(coin_unit_price_ngn)
      })
      .eq('id', targetUserId);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
`,

  'app/api/paystack/init/route.js': `import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req) {
  try {
    const { userId, email, coinsToBuy } = await req.json();
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('coin_unit_price_ngn')
      .eq('id', userId)
      .single();

    const totalNgn = Number(coinsToBuy) * Number(profile.coin_unit_price_ngn);
    const reference = \`COIN_\${Date.now()}_\${userId.slice(0, 6)}\`;

    await supabaseAdmin.from('transactions').insert({
      user_id: userId,
      reference,
      amount_ngn: totalNgn,
      coins_purchased: Number(coinsToBuy)
    });

    const res = await fetch('https://paystack.co', {
      method: 'POST',
      headers: {
        Authorization: \`Bearer \${process.env.PAYSTACK_SECRET_KEY}\`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        amount: Math.round(totalNgn * 100),
        reference,
        callback_url: \`\${process.env.NEXT_PUBLIC_SITE_URL}/?payment=success\`
      })
    });

    const paystackData = await res.json();
    if (!paystackData.status) throw new Error(paystackData.message);
    return NextResponse.json({ authorization_url: paystackData.data.authorization_url });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
`,

  'app/api/paystack/webhook/route.js': `import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-paystack-signature');

  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest('hex');

  if (hash !== signature) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = JSON.parse(rawBody);
  if (event.event === 'charge.success') {
    const reference = event.data.reference;
    const { data: tx } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('reference', reference)
      .eq('status', 'pending')
      .single();

    if (tx) {
      await supabaseAdmin.from('transactions').update({ status: 'success' }).eq('id', tx.id);
      await supabaseAdmin.rpc('increment_coins', {
        user_id_input: tx.user_id,
        amount_input: tx.coins_purchased
      });
    }
  }
  return NextResponse.json({ received: true });
}
`,

  'app/page.jsx': `'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import Logo from '@/components/Logo';

const GAMES_CATALOG = [
  { id: 1, title: 'Brookhaven RP', genre: 'Roleplay', players: '412K', color: 'from-blue-600 to-sky-900', mode: 'city' },
  { id: 2, title: 'Blox Fruits', genre: 'Action', players: '389K', color: 'from-orange-600 to-red-900', mode: 'pirate' },
  { id: 3, title: 'Adopt Me!', genre: 'Roleplay', players: '145K', color: 'from-pink-500 to-rose-900', mode: 'city' },
  { id: 4, title: 'Tower of Hell', genre: 'Parkour', players: '68K', color: 'from-emerald-600 to-teal-900', mode: 'obby' },
  { id: 5, title: 'Murder Mystery 2', genre: 'Survival', players: '112K', color: 'from-red-700 to-zinc-900', mode: 'survival' },
  { id: 6, title: 'Blade Ball', genre: 'Action', players: '94K', color: 'from-indigo-600 to-purple-950', mode: 'arena' },
  { id: 7, title: 'Pet Simulator 99', genre: 'Tycoon', players: '85K', color: 'from-amber-500 to-orange-900', mode: 'tycoon' },
  { id: 8, title: 'Doors', genre: 'Survival', players: '54K', color: 'from-stone-700 to-neutral-950', mode: 'survival' },
  { id: 9, title: 'BedWars', genre: 'Action', players: '61K', color: 'from-cyan-600 to-blue-950', mode: 'arena' },
  { id: 10, title: 'Berry Avenue RP', genre: 'Roleplay', players: '77K', color: 'from-fuchsia-600 to-purple-900', mode: 'city' },
  { id: 11, title: 'Dress To Impress', genre: 'Roleplay', players: '190K', color: 'from-rose-400 to-pink-900', mode: 'city' },
  { id: 12, title: 'The Strongest Battlegrounds', genre: 'Action', players: '132K', color: 'from-slate-600 to-slate-950', mode: 'arena' },
  { id: 13, title: 'Royale High', genre: 'Roleplay', players: '32K', color: 'from-violet-600 to-indigo-950', mode: 'city' },
  { id: 14, title: 'Welcome to Bloxburg', genre: 'Roleplay', players: '48K', color: 'from-teal-600 to-emerald-950', mode: 'city' },
  { id: 15, title: 'Jailbreak', genre: 'Action', players: '29K', color: 'from-amber-600 to-stone-900', mode: 'city' },
  { id: 16, title: 'Natural Disaster Survival', genre: 'Survival', players: '41K', color: 'from-green-600 to-emerald-950', mode: 'survival' },
  { id: 17, title: 'Arsenal', genre: 'Action', players: '24K', color: 'from-red-600 to-orange-950', mode: 'arena' },
  { id: 18, title: 'Livetopia', genre: 'Roleplay', players: '36K', color: 'from-sky-500 to-blue-900', mode: 'city' },
  { id: 19, title: 'Theme Park Tycoon 2', genre: 'Tycoon', players: '22K', color: 'from-yellow-500 to-amber-900', mode: 'tycoon' },
  { id: 20, title: 'Bee Swarm Simulator', genre: 'Tycoon', players: '39K', color: 'from-yellow-400 to-orange-800', mode: 'tycoon' },
  { id: 21, title: 'Anime Defenders', genre: 'Action', players: '71K', color: 'from-purple-600 to-slate-950', mode: 'pirate' },
  { id: 22, title: 'Sol RNG', genre: 'Tycoon', players: '64K', color: 'from-indigo-500 to-zinc-950', mode: 'tycoon' },
  { id: 23, title: 'Dusty Trip', genre: 'Survival', players: '58K', color: 'from-orange-700 to-amber-950', mode: 'survival' },
  { id: 24, title: 'Evade', genre: 'Survival', players: '33K', color: 'from-zinc-700 to-black', mode: 'survival' },
  { id: 25, title: '3008', genre: 'Survival', players: '27K', color: 'from-blue-700 to-yellow-900', mode: 'survival' },
  { id: 26, title: 'Piggy', genre: 'Survival', players: '19K', color: 'from-pink-700 to-zinc-950', mode: 'survival' },
  { id: 27, title: 'Work at a Pizza Place', genre: 'Roleplay', players: '25K', color: 'from-red-500 to-yellow-900', mode: 'tycoon' },
  { id: 28, title: 'Mega Easy Obby', genre: 'Parkour', players: '31K', color: 'from-lime-500 to-green-900', mode: 'obby' },
  { id: 29, title: 'Escape Running Head', genre: 'Parkour', players: '18K', color: 'from-emerald-500 to-cyan-950', mode: 'obby' },
  { id: 30, title: 'Obby But You Are On A Bike', genre: 'Parkour', players: '26K', color: 'from-cyan-500 to-teal-950', mode: 'obby' },
  { id: 31, title: 'Speed Run 4', genre: 'Parkour', players: '15K', color: 'from-violet-500 to-purple-950', mode: 'obby' },
  { id: 32, title: 'Floor Is Lava', genre: 'Parkour', players: '21K', color: 'from-orange-500 to-red-950', mode: 'survival' },
  { id: 33, title: 'King Legacy', genre: 'Action', players: '23K', color: 'from-amber-500 to-red-950', mode: 'pirate' },
  { id: 34, title: 'Grand Piece Online', genre: 'Action', players: '17K', color: 'from-blue-500 to-indigo-950', mode: 'pirate' },
  { id: 35, title: 'Shindo Life', genre: 'Action', players: '16K', color: 'from-red-600 to-stone-950', mode: 'pirate' },
  { id: 36, title: 'All Star Tower Defense', genre: 'Action', players: '20K', color: 'from-yellow-600 to-purple-950', mode: 'arena' },
  { id: 37, title: 'Lumber Tycoon 2', genre: 'Tycoon', players: '14K', color: 'from-amber-700 to-green-950', mode: 'tycoon' },
  { id: 38, title: 'Restaurant Tycoon 2', genre: 'Tycoon', players: '19K', color: 'from-rose-500 to-amber-900', mode: 'tycoon' },
  { id: 39, title: 'Car Dealership Tycoon', genre: 'Tycoon', players: '28K', color: 'from-blue-600 to-slate-900', mode: 'tycoon' },
  { id: 40, title: 'Military Tycoon', genre: 'Tycoon', players: '18K', color: 'from-green-700 to-stone-950', mode: 'tycoon' },
  { id: 41, title: 'Super League Soccer', genre: 'Action', players: '34K', color: 'from-emerald-600 to-green-950', mode: 'arena' },
  { id: 42, title: 'Blue Lock Rivals', genre: 'Action', players: '82K', color: 'from-blue-500 to-cyan-950', mode: 'arena' },
  { id: 43, title: 'Fisch', genre: 'Adventure', players: '120K', color: 'from-teal-500 to-blue-950', mode: 'pirate' },
  { id: 44, title: 'Rivals FPS', genre: 'Action', players: '95K', color: 'from-orange-500 to-zinc-950', mode: 'arena' },
  { id: 45, title: 'Dandy World', genre: 'Survival', players: '67K', color: 'from-purple-500 to-pink-950', mode: 'survival' },
  { id: 46, title: 'Catalog Avatar Creator', genre: 'Roleplay', players: '53K', color: 'from-indigo-500 to-blue-900', mode: 'city' },
  { id: 47, title: 'Pls Donate', genre: 'Tycoon', players: '44K', color: 'from-green-500 to-emerald-900', mode: 'tycoon' },
  { id: 48, title: 'Build A Boat For Treasure', genre: 'Adventure', players: '37K', color: 'from-sky-600 to-amber-900', mode: 'pirate' },
  { id: 49, title: 'Slap Battles', genre: 'Action', players: '46K', color: 'from-yellow-500 to-red-900', mode: 'arena' },
  { id: 50, title: 'Da Hood', genre: 'Roleplay', players: '39K', color: 'from-neutral-700 to-zinc-950', mode: 'city' }
  ];
 
export default function HomePage() {
const [user, setUser] = useState(null);
const [profile, setProfile] = useState(null);
const [isSignUp, setIsSignUp] = useState(false);
const [email, setEmail] = useState('');
const [password, setPassword] = useState('');
const [username, setUsername] = useState('');
const [refCodeInput, setRefCodeInput] = useState('');
const [coinsToBuy, setCoinsToBuy] = useState(100);
const [messages, setMessages] = useState([]);
const [chatInput, setChatInput] = useState('');
const [search, setSearch] = useState('');
const [selectedGenre, setSelectedGenre] = useState('All');
const [loadingPay, setLoadingPay] = useState(false);
useEffect(() => {
const params = new URLSearchParams(window.location.search);
if (params.get('ref')) {
setRefCodeInput(params.get('ref'));
setIsSignUp(true);
}
supabase.auth.getSession().then(({ data: { session } }) => {
if (session?.user) {
setUser(session.user);
loadProfile(session.user.id);
}
});
supabase
.from('chat_messages')
.select('*')
.order('created_at', { ascending: true })
.limit(50)
.then(({ data }) => setMessages(data || []));
const channel = supabase
.channel('public:chat_messages')
.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
setMessages((prev) => [...prev, payload.new]);
})
.subscribe();
return () => supabase.removeChannel(channel);
}, []);
const loadProfile = async (userId) => {
const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
setProfile(data);
};
const handleAuth = async (e) => {
e.preventDefault();
if (isSignUp) {
let referrerId = null;
if (refCodeInput) {
const { data: refUser } = await supabase
.from('profiles')
.select('id')
.eq('referral_code', refCodeInput.trim().toUpperCase())
.single();
if (refUser) referrerId = refUser.id;
}
const { data: authData, error } = await supabase.auth.signUp({ email, password });
if (error) return alert(error.message);
const startingCoins = referrerId ? 55 : 5;
const myRefCode = username.toUpperCase().replace(/\s+/g, '') + Math.floor(100 + Math.random() * 900);
await supabase.from('profiles').insert({
id: authData.user.id,
username,
referral_code: myRefCode,
referred_by: referrerId,
coin_balance: startingCoins,
coin_unit_price_ngn: 15.00
});
if (referrerId) {
await supabase.rpc('increment_coins', { user_id_input: referrerId, amount_input: 100 });
}
window.location.reload();
} else {
const { error } = await supabase.auth.signInWithPassword({ email, password });
if (error) return alert(error.message);
window.location.reload();
}
};
const handleBuyCoins = async () => {
setLoadingPay(true);
const res = await fetch('/api/paystack/init', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ userId: user.id, email: user.email, coinsToBuy })
});
const data = await res.json();
setLoadingPay(false);
if (data.authorization_url) window.location.href = data.authorization_url;
else alert(data.error || 'Payment failed to initialize');
};
const sendMessage = async (e) => {
e.preventDefault();
if (!chatInput.trim() || !profile) return;
await supabase.from('chat_messages').insert({
user_id: user.id,
username: profile.username,
message: chatInput
});
setChatInput('');
};
if (!user || !profile) {
return (


Sign up today & get 5 FREE Coins instantly!

{isSignUp ? 'Create Player Account' : 'Player Login'}
{isSignUp && (
<input type="text" placeholder="Username" required value={username} onChange={(e) => setUsername(e.target.value)} className="w-full p-2.5 rounded bg-slate-800 border border-slate-700" />
)}
<input type="email" placeholder="Email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full p-2.5 rounded bg-slate-800 border border-slate-700" />
<input type="password" placeholder="Password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full p-2.5 rounded bg-slate-800 border border-slate-700" />
{isSignUp && (
<input type="text" placeholder="Referral Code (Optional)" value={refCodeInput} onChange={(e) => setRefCodeInput(e.target.value)} className="w-full p-2.5 rounded bg-slate-800 border border-slate-700" />
)}

{isSignUp ? 'Sign Up & Claim 5 Free Coins' : 'Login'}

<p onClick={() => setIsSignUp(!isSignUp)} className="text-sm text-center text-slate-400 cursor-pointer">
{isSignUp ? 'Already have an account? Login' : 'Need an account? Sign Up'}



);
}
const genres = ['All', 'Roleplay', 'Action', 'Parkour', 'Tycoon', 'Survival', 'Adventure'];
const filteredGames = GAMES_CATALOG.filter((g) => {
const matchesSearch = g.title.toLowerCase().includes(search.toLowerCase());
const matchesGenre = selectedGenre === 'All' || g.genre === selectedGenre;
return matchesSearch && matchesGenre;
});
return (
🪙 {profile.coin_balance} Coins

{profile.role === 'admin' && (
Admin Panel
)}
<button onClick={() => supabase.auth.signOut().then(() => window.location.reload())} className="text-sm text-slate-400 hover:text-white">Logout

{/* Wallet & Paystack */}


Buy Coins (Your Rate: ₦{profile.coin_unit_price_ngn}/coin)

Referral Link: {typeof window !== 'undefined' ? window.location.origin : ''}/?ref={profile.referral_code}



<input type="number" min="10" value={coinsToBuy} onChange={(e) => setCoinsToBuy(e.target.value)} className="w-24 p-2 rounded bg-slate-800 border border-slate-700" />

{loadingPay ? 'Loading...' : `Pay ₦${coinsToBuy * profile.coin_unit_price_ngn}`}


{/* 50-Game Catalog with Search & Genre Tabs */}


All 50 Experiences ({filteredGames.length})
<input
type="text"
placeholder="Search 50 games..."
value={search}
onChange={(e) => setSearch(e.target.value)}
className="p-2 rounded bg-slate-800 border border-slate-700 text-sm w-56"
/>
{genres.map((genre) => (
<button
key={genre}
onClick={() => setSelectedGenre(genre)}
className={`px-3 py-1 rounded-full text-xs font-bold ${
selectedGenre === genre ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
}`}
>
{genre}

))}
{filteredGames.map((game) => (

<div className={`h-28 bg-gradient-to-br ${game.color} flex items-center justify-center font-bold text-base text-center p-2`}>
{game.title}



{game.genre}
👤 {game.players}

<a
href={`/play?mode=${game.mode}&title=${encodeURIComponent(game.title)}`}
className="w-full text-center bg-blue-600 hover:bg-blue-500 py-1.5 rounded text-sm font-bold"
>
Play Now



))}


{/* Live Chat (Numbers Enabled) */}

Global Player Chat (Numbers Allowed)

{messages.map((m) => (

{m.username}: 
{m.message}

))}


<input type="text" placeholder="Type message or numbers..." value={chatInput} onChange={(e) => setChatInput(e.target.value)} className="flex-1 p-2 rounded bg-slate-800 border border-slate-700 text-sm" />
Send




);
}
`,
'app/admin/page.jsx': `'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
export default function AdminPage() {
const [adminId, setAdminId] = useState(null);
const [users, setUsers] = useState([]);
const [authorized, setAuthorized] = useState(false);
useEffect(() => {
supabase.auth.getSession().then(async ({ data: { session } }) => {
if (!session?.user) return;
const { data: me } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
if (me?.role === 'admin') {
setAuthorized(true);
setAdminId(session.user.id);
const { data: allUsers } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
setUsers(allUsers || []);
}
});
}, []);
const handleSave = async (targetUserId) => {
const newCoins = document.getElementById(`coins-${targetUserId}`).value;
const newPrice = document.getElementById(`price-${targetUserId}`).value;
const res = await fetch('/api/admin/update-user', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({
adminId,
targetUserId,
coin_balance: newCoins,
coin_unit_price_ngn: newPrice
})
});
if (res.ok) alert('Updated player successfully!');
else alert('Failed to update player.');
};
if (!authorized) return Checking admin access...;
return (



Admin Control Panel
Back to Platform

{users.map((u) => (
))}

Username	Referral Code	Coins Balance	Price Per Coin (₦)	Action
{u.username}
	{u.referral_code}			

);
}
`,
'app/play/page.jsx': `'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { supabase } from '@/lib/supabase';
export default function PlayGamePage() {
const mountRef = useRef(null);
const [coinsEarned, setCoinsEarned] = useState(0);
const [userId, setUserId] = useState(null);
const [mode, setMode] = useState('arena');
const [gameTitle, setGameTitle] = useState('BloxHub Experience');
const [statusText, setStatusText] = useState('WASD / Arrows to Move • SPACE to Jump');
const [tycoonLevel, setTycoonLevel] = useState(1);
useEffect(() => {
const params = new URLSearchParams(window.location.search);
const currentMode = params.get('mode') || 'arena';
const currentTitle = params.get('title') || 'BloxHub Experience';
setMode(currentMode);
setGameTitle(currentTitle);
supabase.auth.getSession().then(({ data: { session } }) => {
if (session?.user) setUserId(session.user.id);
});
if (currentMode === 'tycoon') {
setStatusText('Click Dropper or Buy Upgrades to generate coins!');
return;
}
const scene = new THREE.Scene();
const skyColors = { obby: 0x0ea5e9, pirate: 0x0284c7, city: 0x3b82f6, survival: 0x450a0a, arena: 0x0f172a };
scene.background = new THREE.Color(skyColors[currentMode] || 0x0f172a);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
mountRef.current.appendChild(renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 0.85));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);
const player = new THREE.Mesh(
new THREE.BoxGeometry(1, 2, 1),
new THREE.MeshStandardMaterial({ color: 0x2563eb })
);
player.position.set(0, 1.5, 0);
scene.add(player);
const platforms = [];
const hazards = [];
if (currentMode === 'obby') {
setStatusText('Jump across floating blocks to reach the Gold Crown (+25 Coins)!');
for (let i = 0; i < 12; i++) {
const plat = new THREE.Mesh(
new THREE.BoxGeometry(3.5, 0.6, 3.5),
new THREE.MeshStandardMaterial({ color: i === 11 ? 0xfacc15 : i % 2 === 0 ? 0x10b981 : 0x34d399 })
);
plat.position.set((i % 2 === 0 ? 1.5 : -1.5), i * 1.1, -i * 4.5);
scene.add(plat);
platforms.push(plat);
}
} else if (currentMode === 'city') {
setStatusText('Explore the city streets and collect city bonuses!');
const road = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x334155 }));
road.rotation.x = -Math.PI / 2;
scene.add(road);
const colors = [0xef4444, 0xf59e0b, 0x8b5cf6, 0xec4899];
for (let i = 0; i < 8; i++) {
const house = new THREE.Mesh(new THREE.BoxGeometry(5, 6, 5), new THREE.MeshStandardMaterial({ color: colors[i % 4] }));
house.position.set((i % 2 === 0 ? -10 : 10), 3, -i * 7 + 15);
scene.add(house);
}
} else if (currentMode === 'survival') {
setStatusText('Dodge the red lava spinners and grab coins!');
const floor = new THREE.Mesh(new THREE.PlaneGeometry(35, 35), new THREE.MeshStandardMaterial({ color: 0x18181b }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
for (let i = 0; i < 4; i++) {
const lava = new THREE.Mesh(new THREE.BoxGeometry(8, 0.6, 1), new THREE.MeshStandardMaterial({ color: 0xdc2626 }));
lava.position.set((i - 1.5) * 6, 0.3, (i % 2 === 0 ? 4 : -4));
scene.add(lava);
hazards.push(lava);
}
} else {
const floorColor = currentMode === 'pirate' ? 0xfde047 : 0x1e293b;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(45, 45), new THREE.MeshStandardMaterial({ color: floorColor }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
}
const target = new THREE.Mesh(
new THREE.CylinderGeometry(0.7, 0.7, 0.25, 16),
new THREE.MeshStandardMaterial({ color: currentMode === 'pirate' ? 0xa855f7 : 0xfacc15 })
);
target.rotation.x = Math.PI / 2;
target.position.set(0, currentMode === 'obby' ? 13.5 : 1, currentMode === 'obby' ? -49.5 : -6);
scene.add(target);
let velY = 0;
let onGround = false;
const keys = {};
const onKeyDown = (e) => {
keys[e.key.toLowerCase()] = true;
if (e.code === 'Space' && onGround) {
velY = 0.32;
onGround = false;
}
};
const onKeyUp = (e) => (keys[e.key.toLowerCase()] = false);
window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);
let animId;
const animate = () => {
animId = requestAnimationFrame(animate);
if (keys['w'] || keys['arrowup']) player.position.z -= 0.16;
if (keys['s'] || keys['arrowdown']) player.position.z += 0.16;
if (keys['a'] || keys['arrowleft']) player.position.x -= 0.16;
if (keys['d'] || keys['arrowright']) player.position.x += 0.16;
velY -= 0.015;
player.position.y += velY;
if (currentMode === 'obby') {
onGround = false;
for (const p of platforms) {
if (
Math.abs(player.position.x - p.position.x) < 2 &&
Math.abs(player.position.z - p.position.z) < 2 &&
player.position.y - 1 <= p.position.y + 0.3 &&
player.position.y - 1 >= p.position.y - 0.8 &&
velY <= 0
) {
player.position.y = p.position.y + 1.3;
velY = 0;
onGround = true;
}
}
if (player.position.y < -10) {
player.position.set(0, 2, 0);
velY = 0;
}
} else if (player.position.y <= 1) {
player.position.y = 1;
velY = 0;
onGround = true;
}
hazards.forEach((h, idx) => {
h.rotation.y += 0.03 * (idx % 2 === 0 ? 1 : -1);
if (player.position.distanceTo(h.position) < 2.2) {
player.position.set(0, 1, 10);
}
});
target.rotation.z += 0.05;
camera.position.set(player.position.x, player.position.y + 7, player.position.z + 11);
camera.lookAt(player.position);
if (player.position.distanceTo(target.position) < 1.8) {
if (currentMode === 'obby') {
player.position.set(0, 2, 0);
setCoinsEarned((c) => c + 25);
} else {
target.position.set((Math.random() - 0.5) * 30, 1, (Math.random() - 0.5) * 30);
setCoinsEarned((c) => c + 5);
}
}
renderer.render(scene, camera);
};
animate();
return () => {
cancelAnimationFrame(animId);
window.removeEventListener('keydown', onKeyDown);
window.removeEventListener('keyup', onKeyUp);
if (mountRef.current) mountRef.current.innerHTML = '';
};
}, []);
useEffect(() => {
if (mode !== 'tycoon') return;
const timer = setInterval(() => {
setCoinsEarned((c) => c + tycoonLevel * 2);
}, 1500);
return () => clearInterval(timer);
}, [mode, tycoonLevel]);
const claimCoins = async () => {
if (!userId || coinsEarned === 0) return;
await supabase.rpc('increment_coins', { user_id_input: userId, amount_input: coinsEarned });
alert(`Saved ${coinsEarned} coins to your wallet!`);
setCoinsEarned(0);
};
return (



Exit
{gameTitle}
Session Coins: {coinsEarned}

Claim to Wallet


{statusText}
{mode === 'tycoon' ? (

{gameTitle} (Level {tycoonLevel})
Auto-generating +{tycoonLevel * 2} coins every 1.5 seconds

<button
onClick={() => setCoinsEarned((c) => c + tycoonLevel)}
className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-6 py-4 rounded-xl text-lg shadow-lg"
>
Click Dropper (+{tycoonLevel} Coins)

<button
onClick={() => {
const cost = tycoonLevel * 20;
if (coinsEarned >= cost) {
setCoinsEarned((c) => c - cost);
setTycoonLevel((l) => l + 1);
} else alert(`Need ${cost} Session Coins to upgrade!`);
}}
className="bg-blue-600 hover:bg-blue-500 font-bold px-6 py-4 rounded-xl text-lg"
>
Upgrade Factory ({tycoonLevel * 20} Coins)



) : (

)}

);
}
`
};
for (const [filePath, content] of Object.entries(files)) {
const fullPath = path.join(process.cwd(), filePath);
fs.mkdirSync(path.dirname(fullPath), { recursive: true });
fs.writeFileSync(fullPath, content);
console.log('Created:', filePath);
}
console.log('\nSUCCESS! 50 Roblox-inspired games + full platform generated.');