from dotenv import load_dotenv
from pydantic_settings import BaseSettings

load_dotenv()


class Settings(BaseSettings):
    # Providers. Add a provider function in ocr.py or ai_extract.py, then point these at it.
    ocr_provider: str = "textract"
    ai_provider: str = "claude"
    ai_model: str = "claude-sonnet-4-6"
    ai_api_key: str = ""

    # AWS Textract.
    aws_region: str = "us-east-1"

    # Hard safety limits.
    max_file_size_mb: int = 50
    max_pages: int = 30
    max_job_cost_usd: float = 2.00
    max_daily_cost_usd: float = 25.00

    # Configurable pricing estimates. Keep these conservative and update if vendor pricing changes.
    textract_analyze_page_usd: float = 0.015
    ai_input_1m_tokens_usd: float = 3.00
    ai_output_1m_tokens_usd: float = 15.00

    # Paths.
    data_dir: str = "data"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
