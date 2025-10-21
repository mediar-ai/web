"""
Brex to PostHog Sync - Modal Scheduled Function
Fetches Brex financial data and sends to PostHog on a schedule
"""

import modal
import os
import requests
import json
from datetime import datetime, timedelta

app = modal.App("brex-posthog-sync")
app.image = modal.Image.debian_slim().pip_install("requests")

# Brex API Configuration
BREX_API_BASE = "https://platform.brexapis.com/v2"

def get_cash_accounts(brex_token):
    """Fetch all cash accounts from Brex API"""
    url = f"{BREX_API_BASE}/accounts/cash"
    headers = {
        "Authorization": f"Bearer {brex_token}",
        "Content-Type": "application/json"
    }

    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        return data.get("items", [])
    except requests.exceptions.RequestException as e:
        print(f"Error fetching cash accounts: {e}")
        return []


def get_account_transactions(account_id, brex_token):
    """Fetch transactions for a specific cash account"""
    url = f"{BREX_API_BASE}/transactions/cash/{account_id}"
    headers = {
        "Authorization": f"Bearer {brex_token}",
        "Content-Type": "application/json"
    }

    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        return data.get("items", [])
    except requests.exceptions.RequestException as e:
        print(f"Error fetching transactions for account {account_id}: {e}")
        return []


def get_card_transactions(brex_token):
    """Fetch all card transactions (paginated)"""
    url = f"{BREX_API_BASE}/transactions/card/primary"
    headers = {
        "Authorization": f"Bearer {brex_token}",
        "Content-Type": "application/json"
    }
    all_transactions = []

    try:
        while url:
            response = requests.get(url, headers=headers)
            response.raise_for_status()
            data = response.json()

            items = data.get("items", [])
            all_transactions.extend(items)

            # Check for pagination
            next_cursor = data.get("next_cursor")
            if next_cursor:
                url = f"{BREX_API_BASE}/transactions/card/primary?cursor={next_cursor}"
            else:
                url = None

        return all_transactions
    except requests.exceptions.RequestException as e:
        print(f"Error fetching card transactions: {e}")
        return []


def calculate_total_balance(accounts):
    """Calculate total balance across all accounts (in dollars)"""
    total_cents = sum(
        account.get("current_balance", {}).get("amount", 0)
        for account in accounts
    )
    return total_cents / 100


def filter_last_7_days_transactions(transactions):
    """Filter transactions from the last 7 days"""
    today = datetime.now().date()
    seven_days_ago = today - timedelta(days=7)

    filtered = []
    for txn in transactions:
        posted_date_str = txn.get("posted_at_date")
        if posted_date_str:
            try:
                posted_date = datetime.strptime(posted_date_str, "%Y-%m-%d").date()
                if posted_date >= seven_days_ago:
                    filtered.append(txn)
            except ValueError:
                continue

    return filtered


def calculate_transaction_total(transactions):
    """Calculate total transaction amount (in dollars)"""
    total_cents = sum(
        txn.get("amount", {}).get("amount", 0)
        for txn in transactions
    )
    return total_cents / 100


def send_to_posthog(event_name, properties, posthog_key, posthog_host, distinct_id):
    """Send event to PostHog using the capture API"""
    url = f"{posthog_host}/capture/"

    payload = {
        "api_key": posthog_key,
        "event": event_name,
        "distinct_id": distinct_id,
        "properties": properties,
        "timestamp": datetime.now().isoformat()
    }

    try:
        response = requests.post(url, json=payload)
        response.raise_for_status()
        print(f"✓ Sent '{event_name}' to PostHog")
        return True
    except requests.exceptions.RequestException as e:
        print(f"✗ Error sending to PostHog: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"  Response: {e.response.text}")
        return False


@app.function(
    secrets=[
        modal.Secret.from_dict({
            "BREX_API_TOKEN": "bxt_DLh3v9PnARZ8P7GeHQXbKlQDt4LtQjewo1sX",
            "POSTHOG_API_KEY": "phc_NFSaZUao49XckpqaeyB3lIEKrFXhhXbKaI81jqZ8yn9",
            "POSTHOG_HOST": "https://eu.i.posthog.com",
            "POSTHOG_DISTINCT_ID": "brex-integration"
        })
    ],
    schedule=modal.Cron("0 9 * * *")  # Run daily at 9 AM UTC
)
def sync_brex_to_posthog():
    """
    Scheduled function that fetches Brex data and sends to PostHog
    Runs daily at 9 AM UTC
    """
    print("=" * 60)
    print(f"BREX TO POSTHOG SYNC - {datetime.now().isoformat()}")
    print("=" * 60)

    # Get credentials from Modal secrets
    brex_token = os.environ.get("BREX_API_TOKEN")
    posthog_key = os.environ.get("POSTHOG_API_KEY")
    posthog_host = os.environ.get("POSTHOG_HOST")
    distinct_id = os.environ.get("POSTHOG_DISTINCT_ID", "brex-integration")

    if not brex_token or not posthog_key:
        print("Error: Missing BREX_API_TOKEN or POSTHOG_API_KEY")
        return

    # Fetch all cash accounts
    print("\nFetching cash accounts...")
    accounts = get_cash_accounts(brex_token)

    if not accounts:
        print("No accounts found or error occurred.")
        return

    print(f"Found {len(accounts)} account(s)")

    # Calculate total balance
    total_balance = calculate_total_balance(accounts)
    print(f"Total Balance: ${total_balance:,.2f}")

    # Fetch cash transactions
    print("\nFetching cash transactions...")
    all_cash_transactions_7d = []

    for account in accounts:
        account_id = account.get("id")
        transactions = get_account_transactions(account_id, brex_token)
        transactions_7d = filter_last_7_days_transactions(transactions)
        all_cash_transactions_7d.extend(transactions_7d)

    print(f"Found {len(all_cash_transactions_7d)} cash transaction(s) in last 7 days")

    # Fetch card transactions
    print("Fetching card transactions...")
    all_card_transactions = get_card_transactions(brex_token)
    card_transactions_7d = filter_last_7_days_transactions(all_card_transactions)
    print(f"Found {len(card_transactions_7d)} card transaction(s) in last 7 days")

    # Combine all transactions
    all_transactions_7d = all_cash_transactions_7d + card_transactions_7d
    print(f"Total combined transactions: {len(all_transactions_7d)}")

    # Calculate metrics
    cash_income_txns = [t for t in all_cash_transactions_7d if t.get("amount", {}).get("amount", 0) > 0]
    cash_expense_txns = [t for t in all_cash_transactions_7d if t.get("amount", {}).get("amount", 0) < 0]
    card_expense_txns = card_transactions_7d

    total_cash_income = calculate_transaction_total(cash_income_txns)
    total_cash_expenses = abs(calculate_transaction_total(cash_expense_txns))
    total_card_expenses = calculate_transaction_total(card_expense_txns)
    total_expenses = total_cash_expenses + total_card_expenses

    print(f"\nMetrics:")
    print(f"  Cash Income: ${total_cash_income:,.2f}")
    print(f"  Cash Expenses: ${total_cash_expenses:,.2f}")
    print(f"  Card Expenses: ${total_card_expenses:,.2f}")
    print(f"  Total Expenses: ${total_expenses:,.2f}")
    print(f"  Net: ${total_cash_income - total_expenses:,.2f}")

    # Send to PostHog
    print("\n" + "=" * 60)
    print("SENDING TO POSTHOG")
    print("=" * 60)

    # Event 1: Account Balance
    send_to_posthog("brex_account_balance", {
        "total_balance_usd": total_balance,
        "accounts": [
            {
                "name": acc.get("name"),
                "balance_usd": acc.get("current_balance", {}).get("amount", 0) / 100,
                "status": acc.get("status"),
                "primary": acc.get("primary", False)
            }
            for acc in accounts
        ]
    }, posthog_key, posthog_host, distinct_id)

    # Event 2: 7-Day Financial Summary
    send_to_posthog("brex_7_day_summary", {
        "total_transactions": len(all_transactions_7d),
        "cash_income_usd": total_cash_income,
        "cash_income_count": len(cash_income_txns),
        "cash_expenses_usd": total_cash_expenses,
        "cash_expenses_count": len(cash_expense_txns),
        "card_expenses_usd": total_card_expenses,
        "card_expenses_count": len(card_expense_txns),
        "total_expenses_usd": total_expenses,
        "net_amount_usd": total_cash_income - total_expenses,
    }, posthog_key, posthog_host, distinct_id)

    # Event 3: Daily metrics (for trending)
    today = datetime.now().date()
    for i in range(7):
        target_date = today - timedelta(days=i)
        target_date_str = target_date.strftime("%Y-%m-%d")

        daily_cash = [t for t in all_cash_transactions_7d if t.get("posted_at_date") == target_date_str]
        daily_card = [t for t in card_transactions_7d if t.get("posted_at_date") == target_date_str]

        daily_income = calculate_transaction_total([t for t in daily_cash if t.get("amount", {}).get("amount", 0) > 0])
        daily_cash_exp = abs(calculate_transaction_total([t for t in daily_cash if t.get("amount", {}).get("amount", 0) < 0]))
        daily_card_exp = calculate_transaction_total(daily_card)

        send_to_posthog("brex_daily_metrics", {
            "date": target_date_str,
            "cash_income_usd": daily_income,
            "cash_expenses_usd": daily_cash_exp,
            "card_expenses_usd": daily_card_exp,
            "total_expenses_usd": daily_cash_exp + daily_card_exp,
            "transaction_count": len(daily_cash) + len(daily_card),
        }, posthog_key, posthog_host, distinct_id)

    print("\n" + "=" * 60)
    print("SYNC COMPLETED SUCCESSFULLY")
    print("=" * 60)


@app.local_entrypoint()
def main():
    """Manual trigger for testing"""
    print("Manual sync triggered...")
    sync_brex_to_posthog.remote()
    print("Done!")
