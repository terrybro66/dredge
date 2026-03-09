# 1. Start Postgres + Redis

docker-compose up -d

# 2. Run migrations

npm run db:migrate --workspace=packages/database

# 3. Start the orchestrator

npm run dev --workspace=apps/orchestrator

# 4. Test it

curl http://localhost:3001/health
curl -X POST http://localhost:3001/query \
 -H "Content-Type: application/json" \
 -d '{"text": "Show me burglaries in Camden last month"}'
