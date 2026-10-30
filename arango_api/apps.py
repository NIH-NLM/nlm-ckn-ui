from django.apps import AppConfig


class ArangoAPIConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "arango_api"

    def ready(self):
        # Fail at startup, including the Docker build's collectstatic, when the
        # collection maps are missing or invalid, not on the first search.
        from arango_api.search_tiers import load_search_tiers

        load_search_tiers()
