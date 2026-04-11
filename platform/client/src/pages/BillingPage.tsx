import React, { useEffect, useState } from "react";
import { billingApi } from "../lib/api";

interface Props {
  user: { id: string; name: string };
}

const PLANS = [
  { key: "free", name: "Free", price: "$0/mo", features: ["5 agents", "1,000 calls/mo", "Community support"] },
  { key: "pro", name: "Pro", price: "$29/mo", features: ["Unlimited agents", "50,000 calls/mo", "Priority support", "Webhooks"] },
  { key: "enterprise", name: "Enterprise", price: "$99/mo", features: ["Unlimited everything", "Custom rate limits", "Dedicated support", "SLA guarantee"] },
];

export default function BillingPage({ user }: Props) {
  const [account, setAccount] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [revenue, setRevenue] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    loadBilling();
    billingApi.revenue().then(setRevenue).catch(() => {});
  }, []);

  async function loadBilling() {
    try {
      const data = await billingApi.get();
      setAccount(data.account);
      setPayments(data.payments);
    } catch {}
    setLoading(false);
  }

  async function handleUpgrade(plan: string) {
    setError("");
    setSuccess("");
    setUpgrading(plan);
    try {
      await billingApi.upgrade(plan);
      setSuccess(`Upgraded to ${plan} plan!`);
      loadBilling();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message);
    }
    setUpgrading("");
  }

  async function handleConnect() {
    setError("");
    setSuccess("");
    setConnecting(true);
    try {
      await billingApi.connect();
      setSuccess("Stripe Connect linked! You can now receive payouts.");
      loadBilling();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message);
    }
    setConnecting(false);
  }

  if (loading) return <div className="text-gray-500">Loading billing...</div>;

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-8">Billing</h1>

      {error && (
        <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 text-sm text-red-400 mb-6">{error}</div>
      )}
      {success && (
        <div className="bg-green-900/20 border border-green-700 rounded-lg p-3 text-sm text-green-400 mb-6">{success}</div>
      )}

      {/* Current Plan */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">Your Plan</h2>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl font-bold text-indigo-400 capitalize">{account?.plan || "free"}</span>
          {account?.stripeConnected && (
            <span className="text-xs bg-green-900/30 text-green-400 px-2 py-0.5 rounded-full">Stripe Connected</span>
          )}
        </div>

        {/* Plan Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLANS.map((plan) => (
            <div
              key={plan.key}
              className={`border rounded-lg p-4 ${
                account?.plan === plan.key
                  ? "border-indigo-500 bg-indigo-950/20"
                  : "border-gray-800 bg-gray-950"
              }`}
            >
              <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
              <p className="text-2xl font-bold text-white my-2">{plan.price}</p>
              <ul className="space-y-1 mb-4">
                {plan.features.map((f) => (
                  <li key={f} className="text-sm text-gray-400">- {f}</li>
                ))}
              </ul>
              {account?.plan === plan.key ? (
                <span className="text-sm text-indigo-400">Current plan</span>
              ) : (
                <button
                  onClick={() => handleUpgrade(plan.key)}
                  disabled={!!upgrading}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded-lg text-sm transition disabled:opacity-50"
                >
                  {upgrading === plan.key ? "Upgrading..." : plan.key === "free" ? "Downgrade" : "Upgrade"}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Creator Payouts */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">Creator Payouts</h2>
        {account?.stripeConnected ? (
          <p className="text-sm text-green-400">Stripe Connect is linked. Payouts enabled.</p>
        ) : (
          <div>
            <p className="text-sm text-gray-400 mb-3">
              Connect your Stripe account to receive payouts from your published agents.
            </p>
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm transition disabled:opacity-50"
            >
              {connecting ? "Connecting..." : "Connect Stripe"}
            </button>
          </div>
        )}

        {/* Revenue Summary */}
        {revenue && revenue.agents?.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-medium text-gray-400 mb-3">Revenue Summary</h3>
            <div className="space-y-2">
              {revenue.agents.map((a: any) => (
                <div key={a.agentId} className="flex items-center justify-between bg-gray-950 rounded-lg p-3">
                  <div>
                    <span className="text-white text-sm">{a.agentName}</span>
                    <span className="text-xs text-gray-500 ml-2">{a.activeSubscribers} subs</span>
                  </div>
                  <span className="text-sm text-green-400">
                    ${a.estimatedMonthlyRevenue.toFixed(2)}/mo
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 text-right">
              <span className="text-lg font-bold text-green-400">
                ${revenue.totalEstimatedMonthly.toFixed(2)}/mo
              </span>
              <span className="text-xs text-gray-500 ml-2">estimated</span>
            </div>
          </div>
        )}
      </div>

      {/* Payment History */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Payment History</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-gray-500">No payments yet.</p>
        ) : (
          <div className="space-y-2">
            {payments.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between bg-gray-950 rounded-lg p-3">
                <div>
                  <span className="text-white text-sm">{p.description || "Payment"}</span>
                  <span className="text-xs text-gray-500 ml-2">
                    {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white">${p.amount.toFixed(2)}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      p.status === "completed"
                        ? "bg-green-900/30 text-green-400"
                        : p.status === "failed"
                        ? "bg-red-900/30 text-red-400"
                        : "bg-gray-800 text-gray-400"
                    }`}
                  >
                    {p.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
