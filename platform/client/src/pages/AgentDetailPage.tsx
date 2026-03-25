import React, { useEffect, useState } from "react";
import { agentsApi, subscriptionsApi } from "../lib/api";

interface Props {
  slug: string;
  user: { id: string } | null;
  onNavigate: (page: any) => void;
}

export default function AgentDetailPage({ slug, user, onNavigate }: Props) {
  const [agent, setAgent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  // Review form state
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [reviewSubmitted, setReviewSubmitted] = useState(false);

  useEffect(() => {
    agentsApi
      .get(slug)
      .then((data) => {
        setAgent(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [slug]);

  async function handleSubscribe() {
    if (!user) {
      onNavigate({ name: "login" });
      return;
    }
    setSubscribing(true);
    try {
      await subscriptionsApi.create(agent.id);
      setSubscribed(true);
    } catch (err: any) {
      if (err.message.includes("Already")) setSubscribed(true);
    }
    setSubscribing(false);
  }

  async function handleReviewSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) {
      onNavigate({ name: "login" });
      return;
    }
    setReviewError("");
    setReviewSubmitting(true);
    try {
      const newReview = await agentsApi.review(slug, {
        rating: reviewRating,
        comment: reviewComment || undefined,
      });
      setAgent({
        ...agent,
        reviews: [newReview, ...(agent.reviews || [])],
      });
      setReviewSubmitted(true);
      setReviewComment("");
    } catch (err: any) {
      setReviewError(err.message);
    }
    setReviewSubmitting(false);
  }

  // Check if user already reviewed
  const userAlreadyReviewed = user && agent?.reviews?.some(
    (r: any) => r.userName === user.id // fallback check below
  );
  const isOwnAgent = user && agent?.creator?.id === user.id;

  if (loading) {
    return <div className="text-center text-gray-500 py-16">Loading...</div>;
  }

  if (!agent) {
    return <div className="text-center text-gray-500 py-16">Agent not found</div>;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <button
        onClick={() => onNavigate({ name: "home" })}
        className="text-sm text-gray-500 hover:text-white mb-6 inline-block"
      >
        ← Back to agents
      </button>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-2">
              {agent.name}
              {agent.healthStatus === "healthy" && (
                <span className="inline-block w-3 h-3 rounded-full bg-green-400" title="Healthy" />
              )}
              {agent.healthStatus === "unhealthy" && (
                <span className="inline-block w-3 h-3 rounded-full bg-red-400" title="Unhealthy" />
              )}
            </h1>
            <p className="text-gray-400">
              by{" "}
              <span className="text-indigo-400">
                {agent.creator.name}
                {agent.creator.verified && " ✓"}
              </span>
              {" · "}v{agent.version}
              {" · "}{agent.category}
            </p>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold text-white mb-2">
              {agent.pricing === "free" && "Free"}
              {agent.pricing === "usage" && `$${agent.pricePerCall}/call`}
              {agent.pricing === "monthly" && `$${agent.monthlyPrice}/mo`}
            </div>
            <button
              onClick={handleSubscribe}
              disabled={subscribing || subscribed}
              className={`px-6 py-2 rounded-lg text-sm font-medium transition ${
                subscribed
                  ? "bg-green-600/20 text-green-400 cursor-default"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white"
              }`}
            >
              {subscribed ? "Subscribed" : subscribing ? "..." : "Subscribe"}
            </button>
          </div>
        </div>

        <p className="text-gray-300 mb-6">{agent.description}</p>

        {agent.longDescription && (
          <div className="text-gray-400 mb-6 whitespace-pre-wrap">
            {agent.longDescription}
          </div>
        )}

        {/* Tags */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {(agent.tags || []).map((tag: string) => (
            <span
              key={tag}
              className="text-xs bg-gray-800 text-gray-400 px-3 py-1 rounded-full"
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-gray-800/50 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-white">{agent.subscriberCount}</div>
            <div className="text-xs text-gray-500">Subscribers</div>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-white">{agent.rateLimit}/min</div>
            <div className="text-xs text-gray-500">Rate Limit</div>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-white">
              {agent.reviews?.length > 0
                ? `★ ${(agent.reviews.reduce((s: number, r: any) => s + r.rating, 0) / agent.reviews.length).toFixed(1)}`
                : "—"}
            </div>
            <div className="text-xs text-gray-500">Rating ({agent.reviews?.length || 0})</div>
          </div>
        </div>

        {/* API Usage Example */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-3">Quick Start</h2>
          <pre className="bg-gray-950 border border-gray-800 rounded-lg p-4 text-sm text-gray-300 overflow-x-auto">
{`curl -X POST https://your-domain/api/call/${agent.slug} \\
  -H "X-API-Key: af_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{"input": {}}'`}
          </pre>
        </div>

        {/* Schema */}
        {agent.schema && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-white mb-3">Schema</h2>
            <pre className="bg-gray-950 border border-gray-800 rounded-lg p-4 text-sm text-gray-300 overflow-x-auto">
              {JSON.stringify(agent.schema, null, 2)}
            </pre>
          </div>
        )}

        {/* Write a Review */}
        {user && !isOwnAgent && !reviewSubmitted && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-white mb-3">Write a Review</h2>
            <form onSubmit={handleReviewSubmit} className="bg-gray-800/50 rounded-lg p-4 space-y-3">
              {reviewError && (
                <div className="text-sm text-red-400">{reviewError}</div>
              )}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Rating</label>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setReviewRating(star)}
                      className={`text-2xl transition ${
                        star <= reviewRating ? "text-yellow-400" : "text-gray-600"
                      }`}
                    >
                      ★
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Comment (optional)</label>
                <textarea
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  rows={3}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 text-sm"
                  placeholder="Share your experience with this agent..."
                />
              </div>
              <button
                type="submit"
                disabled={reviewSubmitting}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm transition disabled:opacity-50"
              >
                {reviewSubmitting ? "Submitting..." : "Submit Review"}
              </button>
            </form>
          </div>
        )}

        {reviewSubmitted && (
          <div className="mb-8 bg-green-900/20 border border-green-700 rounded-lg p-3 text-sm text-green-400">
            Review submitted successfully!
          </div>
        )}

        {/* Reviews */}
        <div>
          <h2 className="text-lg font-semibold text-white mb-3">
            Reviews {agent.reviews?.length > 0 && `(${agent.reviews.length})`}
          </h2>
          {(!agent.reviews || agent.reviews.length === 0) ? (
            <p className="text-sm text-gray-500">No reviews yet. Be the first to review!</p>
          ) : (
            <div className="space-y-4">
              {agent.reviews.map((review: any) => (
                <div
                  key={review.id}
                  className="bg-gray-800/50 rounded-lg p-4"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-yellow-400">
                      {"★".repeat(review.rating)}
                      {"☆".repeat(5 - review.rating)}
                    </span>
                    <span className="text-sm text-gray-400">{review.userName}</span>
                  </div>
                  {review.comment && (
                    <p className="text-sm text-gray-300">{review.comment}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
