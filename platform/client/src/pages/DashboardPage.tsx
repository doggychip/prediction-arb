import React, { useEffect, useState } from "react";
import { subscriptionsApi, keysApi, agentsApi } from "../lib/api";

interface Props {
  user: { id: string; name: string };
  onNavigate: (page: any) => void;
}

export default function DashboardPage({ user, onNavigate }: Props) {
  const [subs, setSubs] = useState<any[]>([]);
  const [keys, setKeys] = useState<any[]>([]);
  const [myAgents, setMyAgents] = useState<any[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [tab, setTab] = useState<"agents" | "subs" | "keys">("agents");
  const [usageSlug, setUsageSlug] = useState<string | null>(null);
  const [usage, setUsage] = useState<any>(null);

  useEffect(() => {
    agentsApi.mine().then((d) => setMyAgents(d.agents)).catch(() => {});
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

  async function toggleAgentStatus(slug: string, currentStatus: string) {
    const newStatus = currentStatus === "active" ? "suspended" : "active";
    await agentsApi.setStatus(slug, newStatus);
    setMyAgents(myAgents.map((a) => (a.slug === slug ? { ...a, status: newStatus } : a)));
  }

  async function deleteAgent(slug: string) {
    await agentsApi.remove(slug);
    setMyAgents(myAgents.filter((a) => a.slug !== slug));
    if (usageSlug === slug) {
      setUsageSlug(null);
      setUsage(null);
    }
  }

  async function loadUsage(slug: string) {
    if (usageSlug === slug) {
      setUsageSlug(null);
      setUsage(null);
      return;
    }
    setUsageSlug(slug);
    setUsage(null);
    try {
      const data = await agentsApi.usage(slug);
      setUsage(data);
    } catch {
      setUsage({ error: true });
    }
  }

  function healthBadge(status: string) {
    if (status === "healthy") return <span className="inline-block w-2 h-2 rounded-full bg-green-400 mr-1.5" title="Healthy" />;
    if (status === "unhealthy") return <span className="inline-block w-2 h-2 rounded-full bg-red-400 mr-1.5" title="Unhealthy" />;
    return <span className="inline-block w-2 h-2 rounded-full bg-gray-600 mr-1.5" title="Unknown" />;
  }

  const tabClass = (t: string) =>
    `pb-3 text-sm font-medium transition ${
      tab === t
        ? "text-indigo-400 border-b-2 border-indigo-400"
        : "text-gray-500 hover:text-white"
    }`;

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-8">Dashboard</h1>

      {/* Tabs */}
      <div className="flex gap-4 mb-6 border-b border-gray-800">
        <button onClick={() => setTab("agents")} className={tabClass("agents")}>
          My Agents ({myAgents.length})
        </button>
        <button onClick={() => setTab("subs")} className={tabClass("subs")}>
          Subscriptions ({subs.length})
        </button>
        <button onClick={() => setTab("keys")} className={tabClass("keys")}>
          API Keys ({keys.length})
        </button>
      </div>

      {/* My Agents */}
      {tab === "agents" && (
        <div className="space-y-3">
          {myAgents.length === 0 && (
            <p className="text-gray-500">
              No agents published yet.{" "}
              <button
                onClick={() => onNavigate({ name: "publish" })}
                className="text-indigo-400 hover:underline"
              >
                Publish your first agent
              </button>
            </p>
          )}
          {myAgents.map((agent) => (
            <div key={agent.id}>
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center">
                    {healthBadge(agent.healthStatus || "unknown")}
                    <button
                      onClick={() => onNavigate({ name: "agent", slug: agent.slug })}
                      className="text-white font-medium hover:text-indigo-400 transition"
                    >
                      {agent.name}
                    </button>
                    <span
                      className={`ml-3 text-xs px-2 py-0.5 rounded-full ${
                        agent.status === "active"
                          ? "bg-green-900/30 text-green-400"
                          : agent.status === "suspended"
                          ? "bg-yellow-900/30 text-yellow-400"
                          : "bg-gray-800 text-gray-500"
                      }`}
                    >
                      {agent.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => loadUsage(agent.slug)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 transition"
                    >
                      {usageSlug === agent.slug ? "Hide Stats" : "Stats"}
                    </button>
                    <button
                      onClick={() => toggleAgentStatus(agent.slug, agent.status)}
                      className={`text-xs transition ${
                        agent.status === "active"
                          ? "text-yellow-400 hover:text-yellow-300"
                          : "text-green-400 hover:text-green-300"
                      }`}
                    >
                      {agent.status === "active" ? "Suspend" : "Activate"}
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete "${agent.name}"? This will cancel all subscriptions.`)) {
                          deleteAgent(agent.slug);
                        }
                      }}
                      className="text-xs text-red-400 hover:text-red-300 transition"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-500 mb-2">{agent.description}</p>
                <div className="flex gap-4 text-xs text-gray-600">
                  <span>{agent.subscriberCount} subscribers</span>
                  <span>{agent.totalCalls} total calls</span>
                  <span>{agent.category}</span>
                  {agent.healthCheckedAt && (
                    <span>
                      Checked {new Date(agent.healthCheckedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </div>

              {/* Usage Stats Panel */}
              {usageSlug === agent.slug && usage && !usage.error && (
                <div className="bg-gray-950 border border-gray-800 border-t-0 rounded-b-lg p-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div className="text-center">
                      <p className="text-xl font-bold text-white">{usage.totalCalls}</p>
                      <p className="text-xs text-gray-500">Total Calls</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-bold text-white">{usage.calls24h}</p>
                      <p className="text-xs text-gray-500">Last 24h</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-bold text-white">{usage.avgLatencyMs}ms</p>
                      <p className="text-xs text-gray-500">Avg Latency</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-bold text-white">{usage.errorRate}%</p>
                      <p className="text-xs text-gray-500">Error Rate</p>
                    </div>
                  </div>

                  {usage.estimatedRevenue > 0 && (
                    <div className="text-center mb-4 py-2 bg-green-900/10 rounded-lg">
                      <p className="text-lg font-bold text-green-400">${usage.estimatedRevenue.toFixed(2)}</p>
                      <p className="text-xs text-gray-500">Estimated Revenue</p>
                    </div>
                  )}

                  {usage.daily.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-2">Last 7 days</p>
                      <div className="flex items-end gap-1 h-16">
                        {usage.daily.map((d: any) => {
                          const max = Math.max(...usage.daily.map((x: any) => x.count), 1);
                          const height = Math.max((d.count / max) * 100, 4);
                          return (
                            <div
                              key={d.date}
                              className="flex-1 bg-indigo-600 rounded-t"
                              style={{ height: `${height}%` }}
                              title={`${d.date}: ${d.count} calls, ${Math.round(d.avgLatency)}ms avg, ${d.errors} errors`}
                            />
                          );
                        })}
                      </div>
                      <div className="flex gap-1 mt-1">
                        {usage.daily.map((d: any) => (
                          <span key={d.date} className="flex-1 text-center text-[10px] text-gray-600">
                            {d.date.slice(5)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

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
