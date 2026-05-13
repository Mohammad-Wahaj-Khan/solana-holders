// src/services/rateLimiter.js
// Token bucket rate limiter for API requests

class RateLimiter {
    constructor(requestsPerSecond) {
        this.interval = 1000 / requestsPerSecond; // milliseconds between requests
        this.lastCallTime = 0;
        this.queue = [];
        this.processing = false;
    }
    
    // Wait for permission to make a request
    async wait() {
        const now = Date.now();
        const timeSinceLastCall = now - this.lastCallTime;
        
        if (timeSinceLastCall < this.interval) {
            const waitTime = this.interval - timeSinceLastCall;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        this.lastCallTime = Date.now();
        return;
    }
    
    // Get current queue length
    getQueueLength() {
        return this.queue.length;
    }
}

module.exports = RateLimiter;