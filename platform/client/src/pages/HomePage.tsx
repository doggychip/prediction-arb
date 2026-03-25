import React, { useEffect, useState } from "react";
import { agentsApi, statsApi } from "../lib/api";

const CATEGORIES = [
  { key: "", label: "All" },
  { key: "trading", label: "Trading" },
  { key: "analysis", label: "Analysis" },
  { key: "data", label: "Data" },
  { key: "automation", label: "Automation" },
  { key: "nlp", label: "NLP" },
  { key: "vision", label: "Vision" },
];

const PAGE_SIZE = 12;

interface Props {
  onNavigate: (page: any) => void;
}

export default function HomePage({ onNavigate }: Props) {
  const [agents, setAgents] = useState<any[]>([]);
  const [stats, setStats] = useState({ agents: 0, creators: 0, subscriptions: 0 });
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
    loadAgents(0);
    statsApi.get().then(setStats).catch(() => {});
  }, [category]);

  async function loadAgents(pageNum: number) {
    setLoading(true);
    try {
      const params: Record<string, any> = { limit: PAGE_SIZE, offset: pageNum * PAGE_SIZE };
      if (category) params.category = category;
      if (search) params.q = search;
      const data = await agentsApi.list(params);
      setAgents(data.agents);
      setTotal(data.total);
    } catch {
      setAgents([]);
      setTotal(0);
    }
    setLoading(false);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(0);
    loadAgents(0);
  }

  function goToPage(p: number) {
    setPage(p);
    loadAgents(p);
    window.scrollTo(0, 0);
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  function pricingLabel(agent: any): string {
    if (agent.pricing === "free") return "Free";
    if (agent.pricing === "usage") return `$${agent.pricePerCall}/call`;
    if (agent.pricing === "monthly") return `$${agent.monthlyPrice}/mo`;
    return agent.pricing;
  }

  return (
    <div>
      {/* Hero */}
      <div className="text-center py-16">
        <h1 className="text-5xl font-bold text-white mb-4">
          Discover AI Agents
        </h1>
        <p className="text-xl text-gray-400 mb-8 max-w-2xl mx-auto">
          A marketplace where developers publish AI agents — and both humans and
          AI systems can discover, subscribe, and consume via API.
        </p>

        <div className="flex justify-center gap-8 text-sm text-gray-500 mb-8">
          <span>
            <span className="text-2xl font-bold text-indigo-400">{stats.agents}</span> agents
          </span>
          <span>
            <span className="text-2xl font-bold text-indigo-400">{stats.creators}</span> creators
          </span>
          <span>
            <span className="text-2xl font-bold text-indigo-400">{stats.subscriptions}</span> subscriptions
          </span>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="max-w-lg mx-auto flex gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents..."
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
          <button
            type="submit"
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg transition"
          >
            Search
          </button>
        </form>
      </div>

      {/* Categories */}
      <div className="flex gap-2 mb-8 flex-wrap">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setCategory(cat.key)}
            className={`px-4 py-2 rounded-full text-sm transition ${
              category === cat.key
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Agent Grid */}
      {loading ? (
        <div className="text-center text-gray-500 py-16">Loading agents...</div>
      ) : agents.length === 0 ? (
        <div className="text-center text-gray-500 py-16">
          No agents found. Be the first to publish one!
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => onNavigate({ name: "agent", slug: agent.slug })}
                className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-left hover:border-indigo-500/50 transition group"
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-lg font-semibold text-white group-hover:text-indigo-400 transition flex items-center">
                    {agent.healthStatus === "healthy" && (
                      <span className="inline-block w-2 h-2 rounded-full bg-green-400 mr-2 flex-shrink-0" title="Healthy" />
                    )}
                    {agent.healthStatus === "unhealthy" && (
                      <span className="inline-block w-2 h-2 rounded-full bg-red-400 mr-2 flex-shrink-0" title="Unhealthy" />
                    )}
                    {agent.name}
                  </h3>
                  <span className="text-xs bg-gray-800 text-gray-400 px-2 py-1 rounded">
                    {pricingLabel(agent)}
                  </span>
                </div>
                <p className="text-sm text-gray-400 mb-4 line-clamp-2">
                  {agent.description}
                </p>
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>
                    by{" "}
                    <span className="text-gray-300">
                      {agent.creator.name}
                      {agent.creator.verified && " ✓"}
                    </span>
                  </span>
                  <div className="flex gap-3">
                    {agent.avgRating > 0 && (
                      <span>★ {agent.avgRating}</span>
                    )}
                    <span>{agent.subscriberCount} subs</span>
                  </div>
                </div>
                <div className="flex gap-1 mt-3 flex-wrap">
                  {(agent.tags || []).slice(0, 3).map((tag: string) => (
                    <span
                      key={tag}
                      className="text-xs bg-gray-800 text-gray-500 px-2 py-0.5 rounded"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-8">
              <button
                onClick={() => goToPage(page - 1)}
                disabled={page === 0}
                className="px-3 py-1.5 text-sm rounded-lg bg-gray-800 text-gray-400 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                Prev
              </button>
              {Array.from({ length: totalPages }, (_, i) => i)
                .filter((i) => i === 0 || i === totalPages - 1 || Math.abs(i - page) <= 2)
                .map((i, idx, arr) => (
                  <React.Fragment key={i}>
                    {idx > 0 && arr[idx - 1] !== i - 1 && (
                      <span className="text-gray-600 px-1">...</span>
                    )}
                    <button
                      onClick={() => goToPage(i)}
                      className={`px-3 py-1.5 text-sm rounded-lg transition ${
                        i === page
                          ? "bg-indigo-600 text-white"
                          : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                      }`}
                    >
                      {i + 1}
                    </button>
                  </React.Fragment>
                ))}
              <button
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages - 1}
                className="px-3 py-1.5 text-sm rounded-lg bg-gray-800 text-gray-400 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                Next
              </button>
              <span className="text-xs text-gray-600 ml-2">
                {total} agent{total !== 1 ? "s" : ""}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
