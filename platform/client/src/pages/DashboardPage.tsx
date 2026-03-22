import React, { useEffect, useState } from "react";
import { subscriptionsApi, keysApi } from "../lib/api";

interface Props {
  user: { id: string; name: string };
  onNavigate: (page: any) => void;
}

export default function DashboardPage({ user, onNavigate }: Props) {
  const [subs, setSubs] = useState<any[]>([]);
  const [keys, setKeys] = useState<any[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [tab, setTab] = useState<"subs" | "keys">("subs");

  useEffect(() => {
    subscriptionsApi.list().then((d) => setSubs(d.subscriptions)).catch(() => {});
    keysApi.list().then((d) => setKeys(d.keys)).catch(() => {});
  }, []);

  async function createKey() {
    if (!newKeyName) return;
    try {
      const result = await keysApi.create(newKeyName);
      setCreatedKey(result.key);
      setNewKeyName("");
      keysApi.list().then((d) => setKeys(d.keys));
    } catch {}
  }

  async function revokeKey(id: string) {
    await keysApi.revoke(id);
    setKeys(keys.filter((k) => k.id !== id));
  }

  async function cancelSub(id: string) {
    await subscriptionsApi.cancel(id);
    setSubs(subs.map((s) => (s.id === id ? { ...s, status: "cancelled" } : s)));
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-8">Dashboard</h1>

      {/* Tabs */}
      <div className="flex gap-4 mb-6 border-b border-gray-800">
        <button
          onClick={() => setTab("subs")}
          className={`pb-3 text-sm font-medium transition ${
            tab === "subs"
              ? "text-indigo-400 border-b-2 border-indigo-400"
              : "text-gray-500 hover:text-white"
          }`}
        >
          Subscriptions ({subs.length})
        </button>
        <button
          onClick={() => setTab("keys")}
          className={`pb-3 text-sm font-medium transition ${
            tab === "keys"
              ? "text-indigo-400 border-b-2 border-indigo-400"
              : "text-gray-500 hover:text-white"
          }`}
        >
          API Keys ({keys.length})
        </button>
      </div>

      {/* Subscriptions */}
      {tab === "subs" && (
        <div className="space-y-3">
          {subs.length === 0 && (
            <p className="text-gray-500">
              No subscriptions yet.{" "}
              <button
                onClick={() => onNavigate({ name: "home" })}
                className="text-indigo-400 hover:underline"
              >
                Explore agents
              </button>
            </p>
          )}
          {subs.map((sub) => (
            <div
              key={sub.id}
              className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex items-center justify-between"
            >
              <div>
                <button
                  onClick={() => onNavigate({ name: "agent", slug: sub.agentSlug })}
                  className="text-white font-medium hover:text-indigo-400 transition"
                >
                  {sub.agentName}
                </button>
                <p className="text-sm text-gray-500">
                  {sub.plan} · {sub.status}
                </p>
              </div>
              {sub.status === "active" && (
                <button
                  onClick={() => cancelSub(sub.id)}
                  className="text-sm text-red-400 hover:text-red-300 transition"
                >
                  Cancel
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* API Keys */}
      {tab === "keys" && (
        <div>
          {/* Create Key */}
          <div className="flex gap-2 mb-6">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name (e.g. production)"
              className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={createKey}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm transition"
            >
              Create Key
            </button>
          </div>

          {/* Show newly created key */}
          {createdKey && (
            <div className="bg-green-900/20 border border-green-700 rounded-lg p-4 mb-6">
              <p className="text-sm text-green-400 mb-2">
                Key created! Copy it now — you won't see it again.
              </p>
              <code className="text-sm text-green-300 bg-gray-950 px-3 py-2 rounded block break-all">
                {createdKey}
              </code>
            </div>
          )}

          <div className="space-y-3">
            {keys.map((key) => (
              <div
                key={key.id}
                className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex items-center justify-between"
              >
                <div>
                  <span className="text-white font-medium">{key.name}</span>
                  <span className="text-sm text-gray-500 ml-3">
                    {key.prefix}...
                  </span>
                  {key.lastUsedAt && (
                    <span className="text-xs text-gray-600 ml-3">
                      Last used: {new Date(key.lastUsedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => revokeKey(key.id)}
                  className="text-sm text-red-400 hover:text-red-300 transition"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
