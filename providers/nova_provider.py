from config import Config
from utils.logger import get_logger

logger = get_logger(__name__)

try:
    import boto3
    _HAS_BOTO3 = True
except ImportError:
    _HAS_BOTO3 = False
    logger.warning("boto3 not installed - NovaProvider will raise if used")


class NovaProvider:
    """
    Amazon Nova via AWS Bedrock's Converse API.
    Uses explicit AWS credentials from Settings if you set them there;
    otherwise falls back to boto3's default credential chain (env
    vars, shared credentials file, or an attached IAM role).
    """

    def __init__(self):
        self.model = Config.NOVA_MODEL

        if not _HAS_BOTO3:
            raise ImportError("boto3 is required for NovaProvider (pip install boto3)")

        client_kwargs = {"region_name": Config.AWS_REGION}
        if Config.AWS_ACCESS_KEY_ID and Config.AWS_SECRET_ACCESS_KEY:
            client_kwargs["aws_access_key_id"] = Config.AWS_ACCESS_KEY_ID
            client_kwargs["aws_secret_access_key"] = Config.AWS_SECRET_ACCESS_KEY

        self.client = boto3.client("bedrock-runtime", **client_kwargs)

    def generate(self, prompt: str, system: str = None) -> str:
        messages = [{"role": "user", "content": [{"text": prompt}]}]

        kwargs = {
            "modelId": self.model,
            "messages": messages,
            "inferenceConfig": {
                "maxTokens": Config.MAX_TOKENS,
                "temperature": Config.TEMPERATURE,
            },
        }
        if system:
            kwargs["system"] = [{"text": system}]

        response = self.client.converse(**kwargs)

        return response["output"]["message"]["content"][0]["text"]
