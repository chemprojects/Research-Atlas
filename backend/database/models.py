from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, Text, LargeBinary, ForeignKey
)
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class Paper(Base):
    __tablename__ = "papers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    doi = Column(String, unique=True, index=True, nullable=True)
    external_id = Column(String, index=True, nullable=True)  # arXiv id, PubMed PMID, etc.
    title = Column(Text, nullable=False)
    abstract = Column(Text, nullable=True)
    authors = Column(Text, nullable=True)          # JSON array of {name, affiliation}
    journal = Column(String, nullable=True)
    source = Column(String, nullable=False)        # openalex | arxiv | pubmed | crossref | rss
    published_date = Column(DateTime, nullable=True)
    fetched_at = Column(DateTime, default=datetime.utcnow)
    embedding = Column(LargeBinary, nullable=True) # numpy array as bytes
    relevance_score = Column(Float, default=0.0)
    tier = Column(String, default="ignored")       # must_read | possibly_relevant | adjacent | ignored
    summary = Column(Text, nullable=True)
    why_it_matters = Column(Text, nullable=True)
    methods_detected = Column(Text, nullable=True) # JSON array of strings
    keywords = Column(Text, nullable=True)         # JSON array of strings
    url = Column(String, nullable=True)
    is_read = Column(Boolean, default=False)
    feedback = Column(String, nullable=True)       # thumbs_up | thumbs_down | skip | None

    feedbacks = relationship("Feedback", back_populates="paper", cascade="all, delete-orphan")


class Source(Base):
    __tablename__ = "sources"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)          # openalex | arxiv | pubmed | crossref | rss
    url = Column(String, nullable=True)
    enabled = Column(Boolean, default=True)
    last_fetched = Column(DateTime, nullable=True)
    paper_count = Column(Integer, default=0)
    config = Column(Text, nullable=True)           # JSON config dict


class ResearchProfile(Base):
    __tablename__ = "research_profiles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    interests = Column(Text, nullable=True)        # JSON array of interest strings
    keywords = Column(Text, nullable=True)         # JSON array of keyword strings
    domains = Column(Text, nullable=True)          # JSON array of domain strings
    authors_of_interest = Column(Text, nullable=True)  # JSON array
    journals_of_interest = Column(Text, nullable=True) # JSON array
    negative_keywords = Column(Text, nullable=True)    # JSON array — papers to down-rank
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class DigestRun(Base):
    __tablename__ = "digest_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(String, nullable=False, index=True)  # YYYY-MM-DD
    status = Column(String, default="pending")          # pending | running | done | failed
    paper_count = Column(Integer, default=0)
    top_paper_ids = Column(Text, nullable=True)         # JSON array of paper ids
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    error = Column(Text, nullable=True)


class Feedback(Base):
    __tablename__ = "feedback"

    id = Column(Integer, primary_key=True, autoincrement=True)
    paper_id = Column(Integer, ForeignKey("papers.id", ondelete="CASCADE"), nullable=False)
    rating = Column(String, nullable=False)  # thumbs_up | thumbs_down | skip
    created_at = Column(DateTime, default=datetime.utcnow)

    paper = relationship("Paper", back_populates="feedbacks")
