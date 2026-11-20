import { NextResponse } from 'next/server';
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
    const reference = `COIN_${Date.now()}_${userId.slice(0, 6)}`;

    await supabaseAdmin.from('transactions').insert({
      user_id: userId,
      reference,
      amount_ngn: totalNgn,
      coins_purchased: Number(coinsToBuy),
    });

    const res = await fetch('https://paystack.co', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: Math.round(totalNgn * 100),
        reference,
        callback_url: `${process.env.NEXT_PUBLIC_SITE_URL}/?payment=success`,
      }),
    });

    const paystackData = await res.json();
    if (!paystackData.status) throw new Error(paystackData.message);
    return NextResponse.json({
      authorization_url: paystackData.data.authorization_url,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
