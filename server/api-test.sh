#!/bin/bash
BASE=http://localhost:3000

echo "--- health"
curl -s $BASE/api/health
echo

echo "--- repos already indexed"
curl -s $BASE/api/repos
echo

echo "--- bad URL (should return a 400 error message)"
curl -s -X POST $BASE/api/ingest -H "Content-Type: application/json" -d '{"url":"https://example.com/x"}'
echo

echo "--- index a public GitHub repo (can take a minute)"
curl -s -X POST $BASE/api/ingest -H "Content-Type: application/json" -d '{"url":"https://github.com/gothinkster/angular-realworld-example-app"}'
echo

echo "--- ask a question (streams as events)"
curl -N -s -X POST $BASE/api/chat -H "Content-Type: application/json" -d '{"repoId":"gothinkster-angular-realworld-example-app","question":"How does authentication work?"}'
echo