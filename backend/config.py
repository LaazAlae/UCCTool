from dotenv import load_dotenv

load_dotenv()

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Providers (swap these to change OCR/AI engine)
    ocr_provider: str = "textract"
    ai_provider: str = "claude"
    ai_model: str = "claude-sonnet-4-6"
    ai_api_key: str = ""

    # AWS (read by boto3 automatically from env)
    aws_region: str = "us-east-1"

    # Limits
    max_file_size_mb: int = 50
    max_pages: int = 30

    # Paths
    data_dir: str = "data"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
